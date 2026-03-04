export type Language = 'en' | 'ja'

export interface TranslationDict {
  sidebar: {
    title: string
    containerSettings: string
    cargoDefinition: string
    cargoList: string
    placementControls: string
    statistics: string
  }
  container: {
    custom: string
    width: string
    height: string
    depth: string
    apply: string
    confirmChange: string
  }
  cargoEditor: {
    name: string
    namePlaceholder: string
    width: string
    height: string
    depth: string
    weight: string
    color: string
    add: string
    import: string
    samples: string
    nameRequired: string
    widthPositive: string
    widthExceeds: string
    heightPositive: string
    heightExceeds: string
    depthPositive: string
    depthExceeds: string
    weightPositive: string
    importedCount: string
    importError: string
    samplesLoaded: string
    samplesError: string
  }
  cargoList: {
    empty: string
    place: string
    delete: string
    noPosition: string
    confirmDeleteDef: string
  }
  placement: {
    selectCargo: string
    position: string
    dimensions: string
    weight: string
    rotation: string
    drop: string
    delete: string
    deselect: string
  }
  stats: {
    weight: string
    fillRate: string
    cog: string
    placementCount: string
    overweight: string
    cogDeviation: string
    floatingCargo: string
    interference: string
  }
  toolbar: {
    save: string
    load: string
    autoPack: string
    check: string
    editor: string
    force: string
  }
  toasts: {
    saved: string
    loaded: string
    invalidSaveFile: string
    loadError: string
    noCargoForPack: string
    noPlaceablePosition: string
    autoPackPartial: string
    autoPackComplete: string
    interferenceFound: string
    noInterference: string
    rotationExceedsContainer: string
    rotationCollision: string
  }
  help: {
    leftDrag: string
    cameraRotate: string
    rightDrag: string
    cameraPan: string
    wheel: string
    zoom: string
    click: string
    selectCargo: string
    leftDragSelected: string
    moveCargo: string
    shiftLeftDrag: string
    freeRotate: string
    dndSidebar: string
    placeCargo: string
    rKey: string
    yAxisRotation: string
    tKey: string
    xAxisRotation: string
    fKey: string
    zAxisRotation: string
    gKey: string
    dropCargo: string
    ctrlZ: string
    undoRedo: string
    deleteKey: string
    deleteCargo: string
    escKey: string
    deselect: string
  }
  viewButtons: {
    front: string
    back: string
    left: string
    right: string
    top: string
    iso: string
  }
  webgpuFallback: {
    title: string
    description: string
    browserList: string
  }
  editor: {
    place: string
    erase: string
    paint: string
    undo: string
    redo: string
    clear: string
    clearConfirm: string
    themeToggle: string
    openSimulator: string
    shapeName: string
    weightKg: string
    brushSize: string
    blocks: string
    bbox: string
    file: string
    exportJson: string
    importJson: string
    invalidShapeFile: string
    fileReadError: string
    color: string
    placeTitle: string
    eraseTitle: string
    paintTitle: string
    undoTitle: string
    redoTitle: string
    clearTitle: string
  }
  common: {
    langLabel: string
  }
}
