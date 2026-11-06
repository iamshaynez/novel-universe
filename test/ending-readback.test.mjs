import { it } from 'node:test';
import assert from 'node:assert/strict';
import { endingSceneNodes } from '../web/ending.mjs';

it('结局 ID 与场景 ID 不同也能回读该场景正文', () => {
  const ir = {
    scenes: { 'final-scene': 'final-1' },
    nodes: {
      'final-1': { id: 'final-1', type: 'line', text: '第一句', next: 'final-2', scene: 'final-scene' },
      'final-2': { id: 'final-2', type: 'line', text: '第二句', next: 'end-node', scene: 'final-scene' },
      'end-node': { id: 'end-node', type: 'ending', endingId: 'E_CUSTOM', scene: 'final-scene' },
    },
  };
  assert.deepEqual(endingSceneNodes(ir, 'E_CUSTOM').map(node => node.text), ['第一句', '第二句']);
  assert.deepEqual(endingSceneNodes(ir, 'E_MISSING'), []);
});
