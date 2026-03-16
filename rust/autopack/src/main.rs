mod auto_packer;
mod occupancy_map;
mod stack_checker;
mod types;
mod voxelizer;

use std::collections::HashMap;
use std::io::Read;
use std::time::{Duration, Instant};

use clap::Parser;

use auto_packer::{auto_pack, AutoPackContext};
use occupancy_map::OccupancyMap;
use types::*;

const MAX_AUTO_PACK_ITEMS: usize = 500;

#[derive(Parser)]
#[command(name = "loadcraft-autopack", about = "Autopack CLI for LoadCraft")]
struct Cli {
    /// SaveData JSON path (omit or "-" for stdin)
    input_file: Option<String>,

    /// Mode: "repack" or "pack_staged"
    #[arg(short, long, default_value = "repack")]
    mode: String,

    /// Timeout in milliseconds
    #[arg(short, long, default_value = "30000")]
    timeout: u64,

    /// Strategy: default, layer, wall, lff
    #[arg(short, long, default_value = "default")]
    strategy: String,

    /// Output file path (omit for stdout)
    #[arg(short, long)]
    output: Option<String>,

    /// Pretty-print output JSON
    #[arg(short, long)]
    pretty: bool,
}

fn main() {
    let cli = Cli::parse();

    // Read input
    let input_json = match &cli.input_file {
        Some(path) if path != "-" => {
            std::fs::read_to_string(path).unwrap_or_else(|e| {
                eprintln!("Error reading file {path}: {e}");
                std::process::exit(1);
            })
        }
        _ => {
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf).unwrap_or_else(|e| {
                eprintln!("Error reading stdin: {e}");
                std::process::exit(1);
            });
            buf
        }
    };

    // Parse SaveData
    let save_data: SaveData = serde_json::from_str(&input_json).unwrap_or_else(|e| {
        eprintln!("Error parsing JSON: {e}");
        std::process::exit(1);
    });

    // Parse strategy
    let strategy: PackStrategy = cli.strategy.parse().unwrap_or_else(|e: String| {
        eprintln!("{e}");
        std::process::exit(1);
    });

    // Build def map
    let def_map: HashMap<&str, &CargoItemDef> = save_data
        .cargo_defs
        .iter()
        .map(|d| (d.id.as_str(), d))
        .collect();

    let deadline = Instant::now() + Duration::from_millis(cli.timeout);

    let output = match cli.mode.as_str() {
        "repack" => run_repack(&save_data, &def_map, strategy, deadline),
        "pack_staged" => run_pack_staged(&save_data, &def_map, strategy, deadline),
        other => {
            eprintln!("Unknown mode: {other}. Use 'repack' or 'pack_staged'.");
            std::process::exit(1);
        }
    };

    // Serialize output
    let output_json = if cli.pretty {
        serde_json::to_string_pretty(&output).unwrap()
    } else {
        serde_json::to_string(&output).unwrap()
    };

    // Write output
    match &cli.output {
        Some(path) => {
            std::fs::write(path, &output_json).unwrap_or_else(|e| {
                eprintln!("Error writing to {path}: {e}");
                std::process::exit(1);
            });
        }
        None => {
            println!("{output_json}");
        }
    }
}

fn run_repack(
    save_data: &SaveData,
    def_map: &HashMap<&str, &CargoItemDef>,
    strategy: PackStrategy,
    deadline: Instant,
) -> PackOutput {
    // Collect all items: existing placements + staged items
    let mut all_items: Vec<CargoItemDef> = Vec::new();

    for p in &save_data.placements {
        if let Some(&def) = def_map.get(p.cargo_def_id.as_str()) {
            all_items.push(def.clone());
        }
    }

    if let Some(staged) = &save_data.staged_items {
        for si in staged {
            if let Some(&def) = def_map.get(si.cargo_def_id.as_str()) {
                for _ in 0..si.count {
                    all_items.push(def.clone());
                }
            }
        }
    }

    if all_items.is_empty() {
        return PackOutput {
            success: false,
            placements: Vec::new(),
            next_instance_id: save_data.next_instance_id,
            failed_def_ids: Vec::new(),
            failure_reasons: Vec::new(),
            staged_items: save_data
                .staged_items
                .clone()
                .unwrap_or_default(),
        };
    }

    if all_items.len() > MAX_AUTO_PACK_ITEMS {
        return PackOutput {
            success: false,
            placements: Vec::new(),
            next_instance_id: save_data.next_instance_id,
            failed_def_ids: Vec::new(),
            failure_reasons: vec![PackFailureReason {
                cargo_def_id: String::new(),
                cargo_name: String::new(),
                code: PackFailureCode::NoFeasiblePosition,
                detail: format!(
                    "Too many items ({}). auto_pack supports up to {} items.",
                    all_items.len(),
                    MAX_AUTO_PACK_ITEMS
                ),
            }],
            staged_items: save_data
                .staged_items
                .clone()
                .unwrap_or_default(),
        };
    }

    let result = auto_pack(
        &all_items,
        &save_data.container,
        save_data.next_instance_id,
        None,
        None,
        Some(deadline),
        strategy,
    );

    // Compute next instance id
    let next_instance_id = result
        .placements
        .iter()
        .map(|p| p.instance_id)
        .max()
        .map(|m| m + 1)
        .unwrap_or(save_data.next_instance_id);

    // Restage items that failed to place
    let mut placed_count_by_def: HashMap<String, u32> = HashMap::new();
    for p in &result.placements {
        *placed_count_by_def
            .entry(p.cargo_def_id.clone())
            .or_insert(0) += 1;
    }
    let mut all_count_by_def: HashMap<String, u32> = HashMap::new();
    for item in &all_items {
        *all_count_by_def.entry(item.id.clone()).or_insert(0) += 1;
    }
    let mut staged_items = Vec::new();
    for (def_id, total_count) in &all_count_by_def {
        let placed = placed_count_by_def.get(def_id).copied().unwrap_or(0);
        let remaining = total_count.saturating_sub(placed);
        if remaining > 0 {
            staged_items.push(StagedItem {
                cargo_def_id: def_id.clone(),
                count: remaining,
            });
        }
    }

    PackOutput {
        success: !result.placements.is_empty(),
        placements: result.placements,
        next_instance_id,
        failed_def_ids: result.failed_def_ids,
        failure_reasons: result.failure_reasons,
        staged_items,
    }
}

fn run_pack_staged(
    save_data: &SaveData,
    def_map: &HashMap<&str, &CargoItemDef>,
    strategy: PackStrategy,
    deadline: Instant,
) -> PackOutput {
    let staged = save_data.staged_items.as_deref().unwrap_or(&[]);

    if staged.is_empty() {
        return PackOutput {
            success: false,
            placements: Vec::new(),
            next_instance_id: save_data.next_instance_id,
            failed_def_ids: Vec::new(),
            failure_reasons: Vec::new(),
            staged_items: Vec::new(),
        };
    }

    // Expand staged items
    let mut items: Vec<CargoItemDef> = Vec::new();
    for si in staged {
        if let Some(&def) = def_map.get(si.cargo_def_id.as_str()) {
            for _ in 0..si.count {
                items.push(def.clone());
            }
        }
    }

    if items.is_empty() {
        return PackOutput {
            success: false,
            placements: Vec::new(),
            next_instance_id: save_data.next_instance_id,
            failed_def_ids: Vec::new(),
            failure_reasons: Vec::new(),
            staged_items: staged.to_vec(),
        };
    }

    if items.len() > MAX_AUTO_PACK_ITEMS {
        return PackOutput {
            success: false,
            placements: Vec::new(),
            next_instance_id: save_data.next_instance_id,
            failed_def_ids: Vec::new(),
            failure_reasons: vec![PackFailureReason {
                cargo_def_id: String::new(),
                cargo_name: String::new(),
                code: PackFailureCode::NoFeasiblePosition,
                detail: format!(
                    "Too many items ({}). auto_pack supports up to {} items.",
                    items.len(),
                    MAX_AUTO_PACK_ITEMS
                ),
            }],
            staged_items: staged.to_vec(),
        };
    }

    // Build OccupancyMap from existing placements
    let occ_map = OccupancyMap::from_placements(
        &save_data.placements,
        &save_data.cargo_defs,
        &save_data.container,
    );

    let result = auto_pack(
        &items,
        &save_data.container,
        save_data.next_instance_id,
        Some(&occ_map),
        Some(AutoPackContext {
            existing_placements: &save_data.placements,
            existing_cargo_defs: &save_data.cargo_defs,
        }),
        Some(deadline),
        strategy,
    );

    let next_instance_id = result
        .placements
        .iter()
        .map(|p| p.instance_id)
        .max()
        .map(|m| m + 1)
        .unwrap_or(save_data.next_instance_id);

    // Decrement staged counts
    let mut placed_count_by_def: HashMap<String, u32> = HashMap::new();
    for p in &result.placements {
        *placed_count_by_def
            .entry(p.cargo_def_id.clone())
            .or_insert(0) += 1;
    }
    let staged_items: Vec<StagedItem> = staged
        .iter()
        .map(|si| StagedItem {
            cargo_def_id: si.cargo_def_id.clone(),
            count: si.count.saturating_sub(
                placed_count_by_def
                    .get(&si.cargo_def_id)
                    .copied()
                    .unwrap_or(0),
            ),
        })
        .filter(|si| si.count > 0)
        .collect();

    PackOutput {
        success: !result.placements.is_empty(),
        placements: result.placements,
        next_instance_id,
        failed_def_ids: result.failed_def_ids,
        failure_reasons: result.failure_reasons,
        staged_items,
    }
}
