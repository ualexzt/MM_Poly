/**
 * Resolution Window Guard — §13.2
 * Disables quoting when market is within disable_near_resolution_minutes of close.
 */

export class ResolutionWindowGuard {
  constructor(private disableWindowMinutes: number) {}

  /** Returns true if quoting should be disabled (market too close to resolution). */
  shouldDisable(endDate: string | undefined): boolean {
    if (!endDate) return false;
    const minutesToEnd = (new Date(endDate).getTime() - Date.now()) / 60000;
    return minutesToEnd < this.disableWindowMinutes;
  }

  minutesRemaining(endDate: string | undefined): number | null {
    if (!endDate) return null;
    return (new Date(endDate).getTime() - Date.now()) / 60000;
  }
}
