use crate::types::{CargoItemDef, ContainerDef, PlacedCargo, Vec3, AABB};
use crate::voxelizer::{compute_rotated_aabb, rotate_vec3};

/// 2D height map over the container's XZ plane.
/// Each cell stores the maximum occupied Y (in cm) for that column.
pub struct OccupancyMap {
    height_map: Vec<u16>,
    cell_size: usize,
    cells_x: usize,
    cells_z: usize,
    container_h: f64,
    container_w: f64,
    container_d: f64,
}

impl OccupancyMap {
    pub fn new(width_cm: f64, height_cm: f64, depth_cm: f64, cell_size: usize) -> Self {
        let cells_x = (width_cm / cell_size as f64).ceil() as usize;
        let cells_z = (depth_cm / cell_size as f64).ceil() as usize;
        Self {
            height_map: vec![0u16; cells_x * cells_z],
            cell_size,
            cells_x,
            cells_z,
            container_h: height_cm,
            container_w: width_cm,
            container_d: depth_cm,
        }
    }

    pub fn new_default(width_cm: f64, height_cm: f64, depth_cm: f64) -> Self {
        Self::new(width_cm, height_cm, depth_cm, 10)
    }

    /// Record an AABB's footprint: for each covered XZ cell, update maxY.
    pub fn mark_aabb(&mut self, aabb: &AABB) {
        let cs = self.cell_size as f64;
        let min_cx = 0usize.max((aabb.min.x / cs).floor() as usize);
        let max_cx = if self.cells_x > 0 {
            (self.cells_x - 1).min(((aabb.max.x / cs).ceil() as usize).saturating_sub(1))
        } else {
            return;
        };
        let min_cz = 0usize.max((aabb.min.z / cs).floor() as usize);
        let max_cz = if self.cells_z > 0 {
            (self.cells_z - 1).min(((aabb.max.z / cs).ceil() as usize).saturating_sub(1))
        } else {
            return;
        };
        let top_y = aabb.max.y.ceil() as u16;

        for cz in min_cz..=max_cz {
            for cx in min_cx..=max_cx {
                let idx = cx + self.cells_x * cz;
                if top_y > self.height_map[idx] {
                    self.height_map[idx] = top_y;
                }
            }
        }
    }

    /// Get the maximum occupied height under a footprint starting at (x,z) with size w×d.
    #[allow(dead_code)]
    pub fn get_stack_height(&self, x: f64, z: f64, w: f64, d: f64) -> f64 {
        let cs = self.cell_size as f64;
        let min_cx = 0usize.max((x / cs).floor() as usize);
        let max_cx = if self.cells_x > 0 {
            (self.cells_x - 1).min((((x + w) / cs).ceil() as usize).saturating_sub(1))
        } else {
            return 0.0;
        };
        let min_cz = 0usize.max((z / cs).floor() as usize);
        let max_cz = if self.cells_z > 0 {
            (self.cells_z - 1).min((((z + d) / cs).ceil() as usize).saturating_sub(1))
        } else {
            return 0.0;
        };

        let mut max_h: u16 = 0;
        for cz in min_cz..=max_cz {
            for cx in min_cx..=max_cx {
                let h = self.height_map[cx + self.cells_x * cz];
                if h > max_h {
                    max_h = h;
                }
            }
        }
        max_h as f64
    }

    /// Find the first position where a w×h×d item fits.
    /// Scans X from 0→max, Z from 0→max, picks position with smallest X, ties broken by lowest Y.
    #[allow(dead_code)]
    pub fn find_position(&self, w: f64, h: f64, d: f64) -> Option<Vec3> {
        let cs = self.cell_size;
        let item_cells_w = (w / cs as f64).ceil() as usize;
        let item_cells_d = (d / cs as f64).ceil() as usize;

        let mut best_pos: Option<Vec3> = None;
        let mut best_y = f64::INFINITY;
        let mut best_x = f64::INFINITY;

        if item_cells_w == 0 || item_cells_d == 0 {
            return None;
        }

        for cx in 0..=self.cells_x.saturating_sub(item_cells_w) {
            for cz in 0..=self.cells_z.saturating_sub(item_cells_d) {
                let mut max_h: u16 = 0;
                for dx in 0..item_cells_w {
                    for dz in 0..item_cells_d {
                        let val = self.height_map[(cx + dx) + self.cells_x * (cz + dz)];
                        if val > max_h {
                            max_h = val;
                        }
                    }
                }
                let x_pos = (cx * cs) as f64;
                if (max_h as f64) + h <= self.container_h {
                    let z_pos = (cz * cs) as f64;
                    // Boundary check (cell rounding may exceed actual dims)
                    if x_pos + w > self.container_w || z_pos + d > self.container_d {
                        continue;
                    }
                    let y = max_h as f64;
                    if x_pos < best_x || (x_pos == best_x && y < best_y) {
                        best_x = x_pos;
                        best_y = y;
                        best_pos = Some(Vec3::new(x_pos, y, z_pos));
                    }
                }
            }
        }

        best_pos
    }

    /// Seal the height map: raise all cells to at least min_y.
    pub fn seal_to_height(&mut self, min_y: f64) {
        let min_y_u16 = min_y as u16;
        for cell in self.height_map.iter_mut() {
            if *cell < min_y_u16 {
                *cell = min_y_u16;
            }
        }
    }

    /// Find multiple feasible candidate positions (ordered by X asc, then Y asc, then Z asc).
    pub fn find_candidate_positions(
        &self,
        w: f64,
        h: f64,
        d: f64,
        max_candidates: usize,
        y_max: Option<f64>,
    ) -> Vec<Vec3> {
        let cs = self.cell_size;
        let item_cells_w = (w / cs as f64).ceil() as usize;
        let item_cells_d = (d / cs as f64).ceil() as usize;
        let mut candidates = Vec::new();

        if item_cells_w == 0 || item_cells_d == 0 {
            return candidates;
        }

        let height_limit = y_max.unwrap_or(self.container_h);

        for cx in 0..=self.cells_x.saturating_sub(item_cells_w) {
            for cz in 0..=self.cells_z.saturating_sub(item_cells_d) {
                let mut max_h: u16 = 0;
                for dx in 0..item_cells_w {
                    for dz in 0..item_cells_d {
                        let val = self.height_map[(cx + dx) + self.cells_x * (cz + dz)];
                        if val > max_h {
                            max_h = val;
                        }
                    }
                }

                let x_pos = (cx * cs) as f64;
                let z_pos = (cz * cs) as f64;
                if (max_h as f64) + h > height_limit {
                    continue;
                }
                if x_pos + w > self.container_w || z_pos + d > self.container_d {
                    continue;
                }

                candidates.push(Vec3::new(x_pos, max_h as f64, z_pos));
                if candidates.len() >= max_candidates {
                    return candidates;
                }
            }
        }

        candidates
    }

    /// Estimate bottom support ratio using the current height map (0.0 - 1.0).
    pub fn get_support_ratio(&self, x: f64, z: f64, w: f64, d: f64, base_y: f64) -> f64 {
        if base_y <= 0.0 {
            return 1.0;
        }

        let cs = self.cell_size as f64;
        let min_cx = 0usize.max((x / cs).floor() as usize);
        let max_cx = if self.cells_x > 0 {
            (self.cells_x - 1).min((((x + w) / cs).ceil() as usize).saturating_sub(1))
        } else {
            return 0.0;
        };
        let min_cz = 0usize.max((z / cs).floor() as usize);
        let max_cz = if self.cells_z > 0 {
            (self.cells_z - 1).min((((z + d) / cs).ceil() as usize).saturating_sub(1))
        } else {
            return 0.0;
        };

        let mut total = 0u32;
        let mut supported = 0u32;
        let base_y_u16 = base_y as u16;

        for cz in min_cz..=max_cz {
            for cx in min_cx..=max_cx {
                total += 1;
                if self.height_map[cx + self.cells_x * cz] == base_y_u16 {
                    supported += 1;
                }
            }
        }

        if total == 0 {
            0.0
        } else {
            supported as f64 / total as f64
        }
    }

    /// Deep copy.
    pub fn clone_map(&self) -> Self {
        Self {
            height_map: self.height_map.clone(),
            cell_size: self.cell_size,
            cells_x: self.cells_x,
            cells_z: self.cells_z,
            container_h: self.container_h,
            container_w: self.container_w,
            container_d: self.container_d,
        }
    }

    /// Build from current placements.
    pub fn from_placements(
        placements: &[PlacedCargo],
        cargo_defs: &[CargoItemDef],
        container: &ContainerDef,
    ) -> Self {
        let mut map = Self::new_default(container.width_cm, container.height_cm, container.depth_cm);
        let def_map: std::collections::HashMap<&str, &CargoItemDef> =
            cargo_defs.iter().map(|d| (d.id.as_str(), d)).collect();

        for p in placements {
            let Some(def) = def_map.get(p.cargo_def_id.as_str()) else {
                continue;
            };

            if let Some(blocks) = &def.blocks {
                mark_composite_blocks(&mut map, blocks, p.position_cm, p.rotation_deg);
            } else {
                let aabb = compute_rotated_aabb(
                    def.width_cm,
                    def.height_cm,
                    def.depth_cm,
                    p.position_cm,
                    p.rotation_deg,
                );
                map.mark_aabb(&aabb);
            }
        }
        map
    }
}

/// Mark each block of a composite shape individually.
fn mark_composite_blocks(
    map: &mut OccupancyMap,
    blocks: &[crate::types::ShapeBlock],
    position: Vec3,
    rotation_deg: Vec3,
) {
    for block in blocks {
        let rotated_offset = rotate_vec3(
            Vec3::new(block.x, block.y, block.z),
            rotation_deg,
        );
        let aabb = compute_rotated_aabb(
            block.w,
            block.h,
            block.d,
            Vec3::new(
                position.x + rotated_offset.x,
                position.y + rotated_offset.y,
                position.z + rotated_offset.z,
            ),
            rotation_deg,
        );
        map.mark_aabb(&aabb);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_map() {
        let map = OccupancyMap::new_default(100.0, 100.0, 100.0);
        assert_eq!(map.get_stack_height(0.0, 0.0, 50.0, 50.0), 0.0);
    }

    #[test]
    fn test_mark_and_stack_height() {
        let mut map = OccupancyMap::new_default(200.0, 200.0, 200.0);
        let aabb = AABB {
            min: Vec3::new(0.0, 0.0, 0.0),
            max: Vec3::new(100.0, 50.0, 100.0),
        };
        map.mark_aabb(&aabb);
        assert_eq!(map.get_stack_height(0.0, 0.0, 50.0, 50.0), 50.0);
        assert_eq!(map.get_stack_height(100.0, 100.0, 50.0, 50.0), 0.0);
    }

    #[test]
    fn test_find_position() {
        let mut map = OccupancyMap::new_default(200.0, 200.0, 200.0);
        // Place a 100x50x100 box at origin
        let aabb = AABB {
            min: Vec3::new(0.0, 0.0, 0.0),
            max: Vec3::new(100.0, 50.0, 100.0),
        };
        map.mark_aabb(&aabb);

        // Finding a 100x50x100: prefers X=0 (back wall), then lowest Y
        // Adjacent floor position at z=100 has y=0 < stacking y=50
        let pos = map.find_position(100.0, 50.0, 100.0);
        assert!(pos.is_some());
        let p = pos.unwrap();
        assert_eq!(p.x, 0.0);
        assert_eq!(p.y, 0.0);
        assert_eq!(p.z, 100.0);
    }

    #[test]
    fn test_support_ratio_floor() {
        let map = OccupancyMap::new_default(200.0, 200.0, 200.0);
        // Floor support should be 1.0
        assert_eq!(map.get_support_ratio(0.0, 0.0, 50.0, 50.0, 0.0), 1.0);
    }

    #[test]
    fn test_seal_to_height() {
        let mut map = OccupancyMap::new_default(100.0, 200.0, 100.0);
        map.seal_to_height(50.0);
        assert_eq!(map.get_stack_height(0.0, 0.0, 50.0, 50.0), 50.0);
    }

    #[test]
    fn test_clone() {
        let mut map = OccupancyMap::new_default(100.0, 100.0, 100.0);
        let aabb = AABB {
            min: Vec3::new(0.0, 0.0, 0.0),
            max: Vec3::new(50.0, 30.0, 50.0),
        };
        map.mark_aabb(&aabb);
        let cloned = map.clone_map();
        assert_eq!(cloned.get_stack_height(0.0, 0.0, 50.0, 50.0), 30.0);
    }
}
