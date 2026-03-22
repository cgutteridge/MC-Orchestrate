/**
 * Layer-map-only mode disables primitive-based passes (`fill_cuboid`, `cylinder`,
 * etc.) so the AI must describe builds with `layerMap.layers` + `palette` only.
 *
 * - **Default (unset or any value other than `false`)**: layer-map-only is **on**.
 * - Set `MCORCH_LAYER_MAP_ONLY=false` to allow primitive passes again (e.g. unit tests).
 *
 * @returns True when primitive passes are rejected by {@link PassSchema}.
 */
export function isLayerMapOnlyBuildMode(): boolean {
  return process.env.MCORCH_LAYER_MAP_ONLY !== "false";
}
