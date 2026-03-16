use std::process::Command;

fn bin_path() -> std::path::PathBuf {
    let mut path = std::env::current_exe().unwrap();
    path.pop(); // remove test binary name
    path.pop(); // remove "deps"
    path.push("loadcraft-autopack");
    path
}

fn run_autopack(input: &str, args: &[&str]) -> serde_json::Value {
    let output = Command::new(bin_path())
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(input.as_bytes())
                .unwrap();
            child.wait_with_output()
        })
        .expect("Failed to run binary");

    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).expect("Invalid JSON output")
}

#[test]
fn test_basic_repack() {
    let input = include_str!("fixtures/basic_repack_input.json");
    let result = run_autopack(input, &["-m", "repack", "-t", "10000"]);

    assert_eq!(result["success"], true);

    let placements = result["placements"].as_array().unwrap();
    assert_eq!(placements.len(), 5); // 3 box-a + 2 box-b

    // Verify all placements are within container bounds
    for p in placements {
        let pos = &p["positionCm"];
        assert!(pos["x"].as_f64().unwrap() >= 0.0);
        assert!(pos["y"].as_f64().unwrap() >= 0.0);
        assert!(pos["z"].as_f64().unwrap() >= 0.0);
    }

    // nextInstanceId should be max instanceId + 1
    let max_id = placements
        .iter()
        .map(|p| p["instanceId"].as_u64().unwrap())
        .max()
        .unwrap();
    assert_eq!(result["nextInstanceId"].as_u64().unwrap(), max_id + 1);

    // No failures expected
    assert!(result["failedDefIds"].as_array().unwrap().is_empty());
    assert!(result["stagedItems"].as_array().unwrap().is_empty());
}

#[test]
fn test_empty_repack() {
    let input = include_str!("fixtures/empty_input.json");
    let result = run_autopack(input, &["-m", "repack"]);

    assert_eq!(result["success"], false);
    assert!(result["placements"].as_array().unwrap().is_empty());
}

#[test]
fn test_pack_staged_with_existing() {
    let input = include_str!("fixtures/pack_staged_input.json");
    let result = run_autopack(input, &["-m", "pack_staged", "-t", "10000"]);

    assert_eq!(result["success"], true);

    // Should place 2 additional items (the staged ones)
    let placements = result["placements"].as_array().unwrap();
    assert_eq!(placements.len(), 2);

    // Instance IDs should start from 2
    for p in placements {
        assert!(p["instanceId"].as_u64().unwrap() >= 2);
    }

    // No staged items remaining
    assert!(result["stagedItems"].as_array().unwrap().is_empty());
}

#[test]
fn test_item_too_large() {
    let input = include_str!("fixtures/too_large_input.json");
    let result = run_autopack(input, &["-m", "repack"]);

    assert_eq!(result["success"], false);
    assert!(result["placements"].as_array().unwrap().is_empty());
    assert_eq!(result["failedDefIds"].as_array().unwrap().len(), 1);

    // Failed item should be restaged
    let staged = result["stagedItems"].as_array().unwrap();
    assert_eq!(staged.len(), 1);
    assert_eq!(staged[0]["cargoDefId"], "huge");
    assert_eq!(staged[0]["count"], 1);
}

#[test]
fn test_noflip_constraint() {
    let input = include_str!("fixtures/noflip_input.json");
    let result = run_autopack(input, &["-m", "repack"]);

    assert_eq!(result["success"], true);

    let placements = result["placements"].as_array().unwrap();
    assert_eq!(placements.len(), 1);

    // noFlip: rotation should only have Y-axis rotation (x=0, z=0)
    let rot = &placements[0]["rotationDeg"];
    assert_eq!(rot["x"].as_f64().unwrap(), 0.0);
    assert_eq!(rot["z"].as_f64().unwrap(), 0.0);
}

#[test]
fn test_stack_constraint() {
    let input = include_str!("fixtures/nostack_input.json");
    let result = run_autopack(input, &["-m", "repack"]);

    // In a 110x200x110 container with 100x50x100 noStack items,
    // only 1 can be placed (no stacking, no room side-by-side)
    let placements = result["placements"].as_array().unwrap();
    assert_eq!(placements.len(), 1);
    assert_eq!(result["failedDefIds"].as_array().unwrap().len(), 2);
}

#[test]
fn test_pretty_output() {
    let input = include_str!("fixtures/single_item_input.json");
    let output = Command::new(bin_path())
        .args(["-m", "repack", "--pretty"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .unwrap()
                .write_all(input.as_bytes())
                .unwrap();
            child.wait_with_output()
        })
        .expect("Failed to run binary");

    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).unwrap();
    // Pretty output should contain newlines and indentation
    assert!(stdout.contains('\n'));
    assert!(stdout.contains("  "));
}

#[test]
fn test_ep_basic_repack() {
    let input = include_str!("fixtures/basic_repack_input.json");
    let result = run_autopack(input, &["-m", "repack", "-t", "10000", "-s", "ep"]);

    assert_eq!(result["success"], true);

    let placements = result["placements"].as_array().unwrap();
    assert_eq!(placements.len(), 5); // 3 box-a + 2 box-b

    for p in placements {
        let pos = &p["positionCm"];
        assert!(pos["x"].as_f64().unwrap() >= 0.0);
        assert!(pos["y"].as_f64().unwrap() >= 0.0);
        assert!(pos["z"].as_f64().unwrap() >= 0.0);
    }

    assert!(result["failedDefIds"].as_array().unwrap().is_empty());
}

#[test]
fn test_json_roundtrip() {
    // Verify that output JSON is valid and all required fields are present
    let input = include_str!("fixtures/basic_repack_input.json");
    let result = run_autopack(input, &["-m", "repack"]);

    // Check all top-level fields exist
    assert!(result.get("success").is_some());
    assert!(result.get("placements").is_some());
    assert!(result.get("nextInstanceId").is_some());
    assert!(result.get("failedDefIds").is_some());
    assert!(result.get("failureReasons").is_some());
    assert!(result.get("stagedItems").is_some());

    // Check placement structure
    for p in result["placements"].as_array().unwrap() {
        assert!(p.get("instanceId").is_some());
        assert!(p.get("cargoDefId").is_some());
        assert!(p.get("positionCm").is_some());
        assert!(p.get("rotationDeg").is_some());

        let pos = &p["positionCm"];
        assert!(pos.get("x").is_some());
        assert!(pos.get("y").is_some());
        assert!(pos.get("z").is_some());
    }
}
