// Unigram encode for the NVIDIA stt_en_citrinet_512 SentencePiece model.
// Pieces are the real tokenizer pieces, checked against sherpa tokens.txt.

const SPI = '\u2581';

export function loadCitrinetPieces(table) {
  const pieces = table.pieces || table;
  const byFirst = new Map();
  for (let i = 0; i < pieces.length; i++) {
    const row = pieces[i];
    const piece = row.piece;
    if (!piece || piece === '<unk>') continue;
    const ch = piece[0];
    let list = byFirst.get(ch);
    if (!list) {
      list = [];
      byFirst.set(ch, list);
    }
    list.push({ id: row.id, piece, score: row.score, len: piece.length });
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.len - a.len);
  return { byFirst, unkId: 0 };
}

export function encodeCitrinet(text, model) {
  const norm = String(text || '').toLowerCase().replace(/[^a-z0-9'\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const marked = norm ? SPI + norm.replace(/ /g, SPI) : '';
  const n = marked.length;
  const best = new Float64Array(n + 1);
  best.fill(-1e30);
  best[0] = 0;
  const prev = new Int32Array(n + 1).fill(-1);
  const which = new Int32Array(n + 1).fill(-1);
  for (let i = 0; i < n; i++) {
    if (best[i] < -1e20) continue;
    const list = model.byFirst.get(marked[i]);
    let matched = false;
    if (list) {
      for (let k = 0; k < list.length; k++) {
        const row = list[k];
        const j = i + row.len;
        if (j > n) continue;
        if (marked.slice(i, j) !== row.piece) continue;
        matched = true;
        const sc = best[i] + row.score;
        if (sc > best[j]) {
          best[j] = sc;
          prev[j] = i;
          which[j] = row.id;
        }
      }
    }
    if (!matched) {
      const j = i + 1;
      const sc = best[i];
      if (sc > best[j]) {
        best[j] = sc;
        prev[j] = i;
        which[j] = model.unkId;
      }
    }
  }
  const ids = [];
  const pieceStrs = [];
  const idToPiece = new Map();
  for (const list of model.byFirst.values()) {
    for (let k = 0; k < list.length; k++) idToPiece.set(list[k].id, list[k].piece);
  }
  idToPiece.set(0, '<unk>');
  for (let j = n; j > 0; ) {
    const i = prev[j];
    const id = which[j];
    if (i < 0 || id < 0) break;
    ids.push(id);
    pieceStrs.push(idToPiece.get(id) || '<unk>');
    j = i;
  }
  ids.reverse();
  pieceStrs.reverse();
  const words = [];
  for (let p = 0; p < pieceStrs.length; p++) {
    const piece = pieceStrs[p];
    const id = ids[p];
    if (!words.length || piece.startsWith(SPI)) {
      words.push({
        text: piece.startsWith(SPI) ? piece.slice(1) : piece,
        ids: [id],
        pieces: [piece],
      });
    } else {
      const cur = words[words.length - 1];
      cur.text += piece;
      cur.ids.push(id);
      cur.pieces.push(piece);
    }
  }
  return { norm, ids, pieces: pieceStrs, words };
}
