import { HistoryStore, type HistoryStorage } from '../HistoryStore';

function memoryStorage(): HistoryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
  };
}

describe('HistoryStore', () => {
  it('adds, lists newest-first, removes and clears', async () => {
    const store = new HistoryStore(memoryStorage());
    expect(await store.list()).toEqual([]);
    const a = await store.add({ kind: 'ocr', imageUri: 'file://a.jpg', sourceKind: 'gallery', ocrText: 'hello' });
    await store.add({ kind: 'detection', imageUri: 'file://b.jpg', sourceKind: 'sample', detections: [], description: 'a person' });
    const items = await store.list();
    expect(items.length).toBe(2);
    expect(items[0].kind).toBe('detection');
    await store.remove(a.id);
    expect((await store.list()).length).toBe(1);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('caps history at MAX_HISTORY_ITEMS', async () => {
    const store = new HistoryStore(memoryStorage());
    for (let i = 0; i < 60; i++) {
      await store.add({ kind: 'ocr', imageUri: `file://${i}.jpg`, sourceKind: 'gallery', ocrText: `t${i}` });
    }
    expect((await store.list()).length).toBe(50);
  });

  it('survives corrupt storage content', async () => {
    const s = memoryStorage();
    await s.setItem('basera.history.v1', 'not json');
    const store = new HistoryStore(s);
    expect(await store.list()).toEqual([]);
  });
});
