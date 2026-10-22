/** Demo behaviour requires an explicit opt-in; an unset or misspelled value must never enable it. */
export function demoModeEnabled() {
  return process.env.DEMO_MODE === "true";
}
