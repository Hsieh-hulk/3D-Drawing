import { dependentsOf, objectName, type Scene, type SceneObject } from '../model/scene';

/**
 * Confirmation text for deleting an object that takes other objects with it, or null when nothing else
 * is affected. Shared by the trash button and the Delete/Backspace shortcut so both behave the same.
 */
export function removeConfirmMessage(scene: Scene, obj: SceneObject): string | null {
  const name = objectName(scene, obj);
  if (obj.kind === 'point') {
    const deps = dependentsOf(scene, obj.id);
    return deps.length > 0 ? `刪除${name} 也會一併刪除以它建立的 ${deps.length} 個物件，確定嗎？` : null;
  }
  if (obj.kind === 'solid') return `刪除${name} 及其頂點（仍被其他物件使用的頂點會保留），確定嗎？`;
  return null;
}

/** True when the object may be removed (no dependents, or the student confirmed). */
export function confirmRemove(
  scene: Scene,
  obj: SceneObject,
  confirmFn: (message: string) => boolean = (m) => window.confirm(m),
): boolean {
  const msg = removeConfirmMessage(scene, obj);
  return msg === null || confirmFn(msg);
}
