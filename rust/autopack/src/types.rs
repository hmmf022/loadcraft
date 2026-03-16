use serde::{Deserialize, Serialize};

// ─── Vec3 ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn zero() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        }
    }
}

// ─── AABB ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AABB {
    pub min: Vec3,
    pub max: Vec3,
}

// ─── Container ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDef {
    pub width_cm: f64,
    pub height_cm: f64,
    pub depth_cm: f64,
    pub max_payload_kg: f64,
}

// ─── Shape Block (composite shapes) ────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShapeBlock {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
    pub h: f64,
    pub d: f64,
    pub color: String,
}

// ─── Cargo Item Definition ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoItemDef {
    pub id: String,
    pub name: String,
    pub width_cm: f64,
    pub height_cm: f64,
    pub depth_cm: f64,
    pub weight_kg: f64,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocks: Option<Vec<ShapeBlock>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_stack_weight_kg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_stack: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_flip: Option<bool>,
}

// ─── Placed Cargo ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedCargo {
    pub instance_id: u32,
    pub cargo_def_id: String,
    pub position_cm: Vec3,
    pub rotation_deg: Vec3,
}

// ─── Staged Item ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedItem {
    pub cargo_def_id: String,
    pub count: u32,
}

// ─── SaveData (input format) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveData {
    pub version: u8,
    pub container: ContainerDef,
    pub cargo_defs: Vec<CargoItemDef>,
    pub placements: Vec<PlacedCargo>,
    pub next_instance_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub staged_items: Option<Vec<StagedItem>>,
}

// ─── Pack result types (output) ────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PackFailureCode {
    OutOfBounds,
    NoFeasiblePosition,
    Collision,
    NoSupport,
    StackConstraint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackFailureReason {
    pub cargo_def_id: String,
    pub cargo_name: String,
    pub code: PackFailureCode,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct PackResult {
    pub placements: Vec<PlacedCargo>,
    pub failed_def_ids: Vec<String>,
    pub failure_reasons: Vec<PackFailureReason>,
}

// ─── CLI output ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackOutput {
    pub success: bool,
    pub placements: Vec<PlacedCargo>,
    pub next_instance_id: u32,
    pub failed_def_ids: Vec<String>,
    pub failure_reasons: Vec<PackFailureReason>,
    pub staged_items: Vec<StagedItem>,
}

// ─── Strategy ──────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackStrategy {
    Default,
    Layer,
    Wall,
    Lff,
    Ep,
}

impl std::str::FromStr for PackStrategy {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "default" => Ok(PackStrategy::Default),
            "layer" => Ok(PackStrategy::Layer),
            "wall" => Ok(PackStrategy::Wall),
            "lff" => Ok(PackStrategy::Lff),
            "ep" => Ok(PackStrategy::Ep),
            _ => Err(format!("Unknown strategy: {s}")),
        }
    }
}

impl std::fmt::Display for PackStrategy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackStrategy::Default => write!(f, "default"),
            PackStrategy::Layer => write!(f, "layer"),
            PackStrategy::Wall => write!(f, "wall"),
            PackStrategy::Lff => write!(f, "lff"),
            PackStrategy::Ep => write!(f, "ep"),
        }
    }
}
