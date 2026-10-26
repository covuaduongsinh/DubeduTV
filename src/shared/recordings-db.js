// Kho bản quay (IndexedDB của tiện ích, chung cho offscreen document và trang
// xem bản quay): thông tin từng bản và các mẩu video MediaRecorder ghi mỗi
// giây – không giữ cả file trong bộ nhớ khi quay video dài.
(function (root) {
  const LTV = (root.LTV = root.LTV || {});

  const DB_NAME = "ltv-recordings";
  const META = "recordings";
  const CHUNKS = "chunks";

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  LTV.createRecordingsDb = function createRecordingsDb(idb = root.indexedDB) {
    let opening = null;

    function open() {
      if (!opening) {
        const req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore(META, { keyPath: "id" });
          const chunks = db.createObjectStore(CHUNKS, {
            keyPath: ["recId", "seq"],
          });
          chunks.createIndex("recId", "recId");
        };
        opening = request(req);
      }
      return opening;
    }

    async function write(stores, fn) {
      const db = await open();
      const tx = db.transaction(stores, "readwrite");
      fn(tx);
      await done(tx);
    }

    async function read(store, fn) {
      const db = await open();
      return request(fn(db.transaction(store, "readonly").objectStore(store)));
    }

    async function remove(id) {
      await write([META, CHUNKS], (tx) => {
        tx.objectStore(META).delete(id);
        tx.objectStore(CHUNKS).delete(
          IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
        );
      });
    }

    return {
      create: (meta) => write([META], (tx) => tx.objectStore(META).put(meta)),
      addChunk: (recId, seq, blob) =>
        write([CHUNKS], (tx) =>
          tx.objectStore(CHUNKS).put({ recId, seq, blob }),
        ),
      async update(id, patch) {
        const current = await read(META, (store) => store.get(id));
        if (!current) return;
        await write([META], (tx) =>
          tx.objectStore(META).put({ ...current, ...patch }),
        );
      },
      get: (id) => read(META, (store) => store.get(id)),
      list: () => read(META, (store) => store.getAll()),
      // Các mẩu video theo đúng thứ tự ghi.
      async blob(id, type) {
        const rows = await read(CHUNKS, (store) =>
          store.index("recId").getAll(id),
        );
        rows.sort((a, b) => a.seq - b.seq);
        return new Blob(
          rows.map((row) => row.blob),
          { type },
        );
      },
      remove,
      // Chỉ giữ keep bản mới nhất.
      async prune(keep) {
        const list = await read(META, (store) => store.getAll());
        for (const id of LTV.recordingsToPrune(list, keep)) await remove(id);
      },
    };
  };
})(globalThis);
