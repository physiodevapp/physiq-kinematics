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
