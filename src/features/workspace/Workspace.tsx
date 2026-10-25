import { ProcessingQueue } from "../queue/ProcessingQueue";
import { ControlsPanel } from "../upscale/ControlsPanel";
import { Stage } from "../upscale/Stage";
import { useGroupJobs, type Group } from "../../stores/queueStore";
import s from "./Workspace.module.css";

/** Image & GIF or Clip workspace: queue · viewer · contextual controls. */
export function Workspace({ group }: { group: Group }) {
  const showQueue = useGroupJobs(group).length > 1;
  return (
    <div className={s.workspace}>
      {showQueue && <ProcessingQueue group={group} />}
      <Stage group={group} />
      <ControlsPanel group={group} />
    </div>
  );
}
