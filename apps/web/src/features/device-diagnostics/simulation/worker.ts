import {
  evolve,
  interpolate,
  type Point,
  type SimulationOptions,
} from "./engine.js";
type Message =
  | {
      id: number;
      mode: "scenario";
      grid: Float32Array;
      options: SimulationOptions;
    }
  | { id: number; mode: "sensors"; points: Point[]; size: number };
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Message>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
worker.onmessage = ({ data }) => {
  const grid =
    data.mode === "scenario"
      ? evolve(data.grid, data.options)
      : interpolate(data.points, data.size);
  worker.postMessage({ id: data.id, grid }, [grid.buffer]);
};
