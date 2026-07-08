export interface KinematicsSeriesEntry {
  t: number[];
  a: number[];
}

export interface KinematicsSeries {
  [joint: string]: KinematicsSeriesEntry;
}

export interface KinematicsPayload {
  startedAt: number;
  duration: number;
  joints: string[];
  series: KinematicsSeries;
}

export interface KinematicsReviewDraft {
  id: number;
  startedAt: number;
  series: KinematicsSeries;
  duration: number;
  joints: string[];
}
