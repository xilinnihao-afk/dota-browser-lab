export type Team = 'allied' | 'enemy';
export type UnitKind = 'hero' | 'creep' | 'tower';
export type UnitStatus = 'idle' | 'moving' | 'windup' | 'attacking' | 'dead';
export interface Point { x: number; z: number }
export interface Unit extends Point {
  id: string; name: string; team: Team; kind: UnitKind;
  facing: number; hp: number; maxHp: number; radius: number; speed: number;
  damage: number; attackRange: number; attackPeriod: number; windup: number;
  attackTimer: number; windupLeft: number; actionTime: number;
  status: UnitStatus; targetId: string | null; path: Point[]; home: Point;
  hitFlash: number; deathTime: number; repathTimer: number;
}
export interface GameEvent { id: number; type: 'command' | 'attack' | 'hit' | 'kill' | 'win' | 'lose' | 'heal'; x: number; z: number; sourceId?: string; targetId?: string; amount?: number; team?: Team; time: number }
export interface GameState {
  time: number; units: Unit[]; heroId: string; selectedId: string; hoveredId: string | null;
  phase: 'playing' | 'won' | 'lost'; paused: boolean; kills: number; gold: number;
  attackMode: boolean; objective: string; command: string;
  destination: Point | null; events: GameEvent[];
}
export interface RenderMetrics { fps: number; frameMs: number; calls: number; triangles: number; geometries: number; textures: number }
export interface HudSnapshot {
  state: GameState; hero: Unit; selected: Unit; metrics: RenderMetrics;
  muted: boolean; showPaths: boolean; cameraLocked: boolean;
}
export interface HudActions {
  onAttackMode: () => void; onStop: () => void; onCenter: () => void;
  onReset: () => void; onPause: () => void; onMute: () => void;
  onTogglePaths: () => void; onMinimap: (x: number, z: number) => void;
}
export interface MapObstacle extends Point { radius: number; kind: 'tree' | 'rock' | 'tower'; scale: number; variant: number }
export interface MapDefinition { size: number; seed: number; obstacles: MapObstacle[] }
