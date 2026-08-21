// ---------------------------------------------------------------
// exif.js
// 写真そのものに埋め込まれた撮影情報(EXIF)を読み取る。
//
// 量の判定がこのアプリのいちばん難しいところで、見た目だけでは
// 「大盛り」なのか「カメラを近づけただけ」なのか区別がつかない。
// そこで、35mm換算焦点距離・被写体距離・画素数などを写真から取り出し、
// 「この写真の横幅は被写体の位置で何cmに相当するか」まで計算して
// AIに一緒に渡す。これがあると量の推定が具体的な寸法の話になる。
//
// 位置情報(GPS)は意図的に読まない。食事の写真から自宅や勤務先が
// 割り出せてしまうため、AIサービスに送る情報には含めない。
// ---------------------------------------------------------------

// 35mmフルサイズの横幅(mm)。35mm換算焦点距離から画角を出すのに使う。
const FRAME_WIDTH_MM = 36;

const IFD0_TAGS = {
  0x010f: "make",
  0x0110: "model",
  0x0112: "orientation",
  0x0132: "dateTime",
  0x8769: "_exifIfdPointer",
};

const EXIF_TAGS = {
  0x829a: "exposureTime",
  0x829d: "fNumber",
  0x8827: "iso",
  0x9003: "dateTimeOriginal",
  0x9206: "subjectDistance",
  0x9209: "flash",
  0x920a: "focalLength",
  0xa002: "pixelXDimension",
  0xa003: "pixelYDimension",
  0xa404: "digitalZoomRatio",
  0xa405: "focalLength35mm",
  0xa406: "sceneCaptureType",
  0xa40c: "subjectDistanceRange",
  0xa433: "lensMake",
  0xa434: "lensModel",
};

const SUBJECT_DISTANCE_RANGE = { 1: "マクロ(至近)", 2: "近距離", 3: "遠距離" };

function readAscii(view, offset, length) {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

// 1 BYTE / 2 ASCII / 3 SHORT / 4 LONG / 5 RATIONAL / 7 UNDEFINED
// 9 SLONG / 10 SRATIONAL / 11 FLOAT / 12 DOUBLE
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 };

function readTagValue(view, tiffStart, entryOffset, little) {
  const type = view.getUint16(entryOffset + 2, little);
  const count = view.getUint32(entryOffset + 4, little);
  const size = (TYPE_SIZE[type] || 0) * count;
  if (!size) return null;
  const valueOffset = size <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, little);
  if (valueOffset < 0 || valueOffset + size > view.byteLength) return null;

  switch (type) {
    case 2:
      return readAscii(view, valueOffset, count);
    case 1:
    case 7:
      return view.getUint8(valueOffset);
    case 3:
      return view.getUint16(valueOffset, little);
    case 4:
      return view.getUint32(valueOffset, little);
    case 9:
      return view.getInt32(valueOffset, little);
    case 5:
    case 10: {
      const num = type === 5 ? view.getUint32(valueOffset, little) : view.getInt32(valueOffset, little);
      const den = type === 5 ? view.getUint32(valueOffset + 4, little) : view.getInt32(valueOffset + 4, little);
      return den === 0 ? null : num / den;
    }
    // カメラはRATIONALで書くのが普通だが、書き出しソフトによってはFLOAT/DOUBLEを使う
    case 11:
      return view.getFloat32(valueOffset, little);
    case 12:
      return view.getFloat64(valueOffset, little);
    default:
      return null;
  }
}

function readIfd(view, tiffStart, dirStart, little, tagMap, out) {
  if (dirStart + 2 > view.byteLength) return;
  const entries = view.getUint16(dirStart, little);
  for (let i = 0; i < entries; i++) {
    const entry = dirStart + 2 + i * 12;
    if (entry + 12 > view.byteLength) return;
    const name = tagMap[view.getUint16(entry, little)];
    if (!name) continue;
    const value = readTagValue(view, tiffStart, entry, little);
    if (value !== null && value !== "") out[name] = value;
  }
}

function parseTiff(view, tiffStart) {
  if (tiffStart + 8 > view.byteLength) return null;
  const order = readAscii(view, tiffStart, 2);
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  if (view.getUint16(tiffStart + 2, little) !== 42) return null;

  const tags = {};
  readIfd(view, tiffStart, tiffStart + view.getUint32(tiffStart + 4, little), little, IFD0_TAGS, tags);
  if (tags._exifIfdPointer) {
    readIfd(view, tiffStart, tiffStart + tags._exifIfdPointer, little, EXIF_TAGS, tags);
    delete tags._exifIfdPointer;
  }
  return tags;
}

// JPEGのAPP1セグメントからEXIFを探す。GPSのIFDには最初から入らない。
async function readExifTags(file) {
  try {
    const head = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(head);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) return null;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) return null; // 画像本体に入った
      const segLength = view.getUint16(offset + 2, false);
      if (segLength < 2) return null;
      if (marker === 0xe1 && readAscii(view, offset + 4, 4) === "Exif") {
        return parseTiff(view, offset + 10);
      }
      offset += 2 + segLength;
    }
  } catch (e) {
    /* EXIFが読めなくても解析自体は続ける */
  }
  return null;
}

// ---------------------------------------------------------------
// 撮影情報から「写る範囲の実寸」を求める
// ---------------------------------------------------------------

function deriveGeometry(tags, imageWidth, imageHeight) {
  const d = {};
  const f35 = Number(tags?.focalLength35mm) || null;
  const f = Number(tags?.focalLength) || null;

  if (f35 && f35 > 0) {
    d.focalLength35mm = Math.round(f35);
    // 水平画角(度)。35mm換算の焦点距離から求まる。
    d.horizontalAngleOfView = Math.round((2 * Math.atan(FRAME_WIDTH_MM / (2 * f35)) * 180) / Math.PI);
    if (f && f > 0) d.cropFactor = Math.round((f35 / f) * 10) / 10;
  }
  if (f && f > 0) d.focalLength = Math.round(f * 10) / 10;

  const dist = Number(tags?.subjectDistance);
  if (f35 && f35 > 0 && dist > 0 && dist < 20) {
    d.subjectDistanceM = Math.round(dist * 100) / 100;
    // 相似三角形: 写る横幅 / 被写体距離 = 35mm枠の横幅 / 35mm換算焦点距離
    const frameWidthCm = (dist * 1000 * (FRAME_WIDTH_MM / f35)) / 10;
    d.frameWidthCm = Math.round(frameWidthCm * 10) / 10;
    if (imageHeight && imageWidth) {
      d.frameHeightCm = Math.round(frameWidthCm * (imageHeight / imageWidth) * 10) / 10;
    }
    if (imageWidth) d.cmPerPixel = Math.round((frameWidthCm / imageWidth) * 10000) / 10000;
  }
  return d;
}

// 解析に必要な撮影情報をまとめて取り出す
async function readCaptureInfo(file, imageWidth, imageHeight) {
  const tags = await readExifTags(file);
  const info = {
    hasExif: !!tags,
    fileType: file.type || "",
    fileSizeKb: Math.round(file.size / 1024),
    imageWidth: imageWidth || Number(tags?.pixelXDimension) || null,
    imageHeight: imageHeight || Number(tags?.pixelYDimension) || null,
  };
  if (!tags) return info;

  info.make = tags.make || null;
  info.model = tags.model || null;
  info.lensModel = tags.lensModel || null;
  info.orientation = tags.orientation || null;
  info.dateTimeOriginal = tags.dateTimeOriginal || tags.dateTime || null;
  info.fNumber = tags.fNumber ? Math.round(tags.fNumber * 10) / 10 : null;
  info.iso = tags.iso || null;
  info.digitalZoomRatio = tags.digitalZoomRatio && tags.digitalZoomRatio > 0
    ? Math.round(tags.digitalZoomRatio * 100) / 100
    : null;
  info.subjectDistanceRange = SUBJECT_DISTANCE_RANGE[tags.subjectDistanceRange] || null;
  info.geometry = deriveGeometry(tags, info.imageWidth, info.imageHeight);
  return info;
}

// ---------------------------------------------------------------
// AIに渡す文章にする
// ---------------------------------------------------------------

function captureInfoText(info) {
  if (!info) return "";
  const lines = [];

  if (info.imageWidth && info.imageHeight) {
    lines.push(`・元の画像サイズ: ${info.imageWidth} × ${info.imageHeight} ピクセル`);
  }

  if (!info.hasExif) {
    lines.push("・撮影情報(EXIF)なし。スクリーンショット、保存・加工された画像、または撮影情報が削除された写真の可能性が高い。");
    lines.push("  この場合、画面に写る大きさから距離を推定することはできない。写り込んだ既知の大きさのものだけを手がかりにすること。");
    return lines.join("\n");
  }

  const cam = [info.make, info.model].filter(Boolean).join(" ");
  if (cam) lines.push(`・撮影機材: ${cam}${info.lensModel ? ` / ${info.lensModel}` : ""}`);

  const g = info.geometry || {};
  if (g.focalLength35mm) {
    lines.push(`・35mm換算焦点距離: ${g.focalLength35mm}mm(水平画角 約${g.horizontalAngleOfView}度)`);
  } else if (g.focalLength) {
    lines.push(`・焦点距離: ${g.focalLength}mm(35mm換算値は記録されていない)`);
  }
  if (info.digitalZoomRatio && info.digitalZoomRatio !== 1) {
    lines.push(`・デジタルズーム: ${info.digitalZoomRatio}倍`);
  }
  if (g.subjectDistanceM) {
    lines.push(`・被写体までの距離: 約${g.subjectDistanceM}m`);
  } else if (info.subjectDistanceRange) {
    lines.push(`・被写体距離の区分: ${info.subjectDistanceRange}`);
  }

  if (g.frameWidthCm) {
    lines.push(
      `・【重要】上記から計算した、写真に写っている範囲の実寸: 横 約${g.frameWidthCm}cm` +
        (g.frameHeightCm ? ` × 縦 約${g.frameHeightCm}cm` : "") +
        `。つまり画像の横幅いっぱいが実際の約${g.frameWidthCm}cmに相当する。この寸法を基準に、料理や食器が画像の何割を占めるかから実際の大きさを求めること。`
    );
  } else if (g.horizontalAngleOfView) {
    lines.push(
      `・被写体距離が記録されていないため実寸は確定できない。ただし手に持った端末で料理を撮る場合、被写体距離はおおむね25〜45cmであることが多い。` +
        `水平画角${g.horizontalAngleOfView}度なら、距離30cmでの横幅は約${Math.round(2 * 30 * Math.tan((g.horizontalAngleOfView * Math.PI) / 180 / 2))}cmに相当する。`
    );
  }
  if (info.fNumber) lines.push(`・絞り: F${info.fNumber}${info.iso ? ` / ISO ${info.iso}` : ""}`);

  return lines.join("\n");
}
