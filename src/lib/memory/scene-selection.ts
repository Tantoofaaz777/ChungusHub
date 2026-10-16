export interface SceneBounds { startId: string | null; endId: string | null }

/** Explicit boundaries keep their meaning: crossing the other end clears it, and
 *  a branch change cannot leave a boundary pointing outside the visible history. */
export function markSceneBoundary(
	path: readonly { id: string }[], current: SceneBounds | null,
	boundary: 'start' | 'end', id: string
): SceneBounds | null {
	const positions = new Map(path.map((message, index) => [message.id, index]));
	const index = positions.get(id);
	if (index === undefined) return null;
	let startId = current?.startId && positions.has(current.startId) ? current.startId : null;
	let endId = current?.endId && positions.has(current.endId) ? current.endId : null;
	if (boundary === 'start') {
		startId = id;
		if (endId && positions.get(endId)! < index) endId = null;
	} else {
		endId = id;
		if (startId && positions.get(startId)! > index) startId = null;
	}
	return { startId, endId };
}
