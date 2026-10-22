// Codificador de códigos QR (ISO/IEC 18004) mínimo y sin dependencias: modo byte, corrección de errores nivel M, versiones 1 a 10
// (hasta 213 bytes, de sobra para una URL de verificación). Existe para no añadir una librería solo por un cuadro: el resultado se
// dibuja en el PDF como rectángulos vectoriales. Las pruebas comprueban el vector de Reed-Solomon de la norma, los bits de formato y
// versión, y decodifican la matriz para recuperar el texto original.

type Matrix = boolean[][];

// Por versión (índice = versión): bloques [cantidad, datos por bloque] y codewords de corrección por bloque. Nivel M.
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS: Array<Array<[number, number]>> = [[], [[1, 16]], [[1, 28]], [[1, 44]], [[2, 32]], [[2, 43]], [[4, 27]], [[4, 31]], [[2, 38], [2, 39]], [[3, 36], [2, 37]], [[4, 43], [1, 44]]];
const ALIGNMENT = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
export const MAX_VERSION = 10;
export const FORMAT_BITS_M = 0; // indicador del nivel M en la información de formato

// Estructura de bloques (cantidad y tamaño de datos) y codewords de corrección por bloque: la usan las pruebas para decodificar la matriz.
export const blockLayout = (version: number) => ({ blocks: BLOCKS[version], ecPerBlock: EC_PER_BLOCK[version] });
export const dataCodewords = (version: number) => BLOCKS[version].reduce((sum, [count, size]) => sum + count * size, 0);
export const byteCapacity = (version: number) => Math.floor((dataCodewords(version) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);

// ---- Reed-Solomon sobre GF(256), polinomio 0x11D ----
function gfMultiply(a: number, b: number): number {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((b >>> i) & 1) * a;
  }
  return result;
}
function divisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}
export function reedSolomonRemainder(data: readonly number[], degree: number): number[] {
  const generator = divisor(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    generator.forEach((coefficient, i) => { result[i] ^= gfMultiply(coefficient, factor); });
  }
  return result;
}

// ---- Información de formato y de versión (códigos BCH) ----
export function formatBits(mask: number): number {
  const data = (FORMAT_BITS_M << 3) | mask;
  let rest = data;
  for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  return ((data << 10) | rest) ^ 0x5412;
}
export function versionBits(version: number): number {
  let rest = version;
  for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
  return (version << 12) | rest;
}

// ---- Datos: modo byte, terminador, relleno y entrelazado con corrección ----
function dataBytes(bytes: Buffer, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = dataCodewords(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < dataCodewords(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}
function interleave(data: number[], version: number): number[] {
  const ecLength = EC_PER_BLOCK[version];
  const blocks: Array<{ data: number[]; ec: number[] }> = [];
  let offset = 0;
  for (const [count, size] of BLOCKS[version]) {
    for (let i = 0; i < count; i++) {
      const chunk = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: chunk, ec: reedSolomonRemainder(chunk, ecLength) });
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map(block => block.data.length));
  for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  for (let i = 0; i < ecLength; i++) for (const block of blocks) out.push(block.ec[i]);
  return out;
}

// ---- Matriz ----
class Builder {
  readonly size: number;
  readonly modules: Matrix;
  readonly reserved: Matrix;
  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }
  private set(x: number, y: number, dark: boolean) { this.modules[y][x] = dark; this.reserved[y][x] = true; }
  private finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, distance !== 2 && distance !== 4);
    }
  }
  private alignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  private drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(this.size - 4, 3); this.finder(3, this.size - 4);
    const positions = ALIGNMENT[this.version], last = positions.length - 1;
    positions.forEach((py, i) => positions.forEach((px, j) => {
      if (!((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0))) this.alignment(px, py);
    }));
    this.drawFormat(0); // reserva; se reescribe con la máscara elegida
    if (this.version >= 7) {
      const bits = versionBits(this.version);
      for (let i = 0; i < 18; i++) {
        const bit = ((bits >>> i) & 1) === 1, a = this.size - 11 + (i % 3), b = Math.floor(i / 3);
        this.set(a, b, bit); this.set(b, a, bit);
      }
    }
  }
  drawFormat(mask: number) {
    const bits = formatBits(mask), bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6)); this.set(8, 8, bit(7)); this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true); // módulo oscuro fijo
  }
  drawCodewords(codewords: number[]) {
    let index = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? this.size - 1 - vertical : vertical;
          if (!this.reserved[y][x] && index < codewords.length * 8) {
            this.modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
            index++;
          }
        }
      }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      if (!this.reserved[y][x] && maskApplies(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
    }
  }
}

export function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
  }
}

// Penalización de la norma (reglas 1 a 4): se elige la máscara que deja la matriz más fácil de leer.
function penalty(m: Matrix): number {
  const size = m.length;
  let score = 0, dark = 0;
  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let run = 1, history = '';
      for (let j = 0; j < size; j++) {
        history += get(i, j) ? '1' : '0';
        if (j > 0 && get(i, j) === get(i, j - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
      }
      for (let at = history.indexOf('10111010000'); at !== -1; at = history.indexOf('10111010000', at + 1)) score += 40;
      for (let at = history.indexOf('00001011101'); at !== -1; at = history.indexOf('00001011101', at + 1)) score += 40;
    }
  };
  runs((i, j) => m[i][j]);
  runs((i, j) => m[j][i]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (m[y][x]) dark++;
    if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  const total = size * size;
  return score + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

export class QrTooLongError extends Error {
  constructor() { super('El texto no cabe en el código QR admitido (máximo ' + byteCapacity(MAX_VERSION) + ' bytes).'); }
}

// Devuelve la matriz de módulos (true = oscuro), sin zona de silencio.
export function encodeQr(text: string): Matrix {
  const bytes = Buffer.from(text, 'utf8');
  let version = 1;
  while (version <= MAX_VERSION && bytes.length > byteCapacity(version)) version++;
  if (version > MAX_VERSION) throw new QrTooLongError();
  const codewords = interleave(dataBytes(bytes, version), version);
  let best: Matrix | null = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const builder = new Builder(version);
    builder.drawCodewords(codewords);
    builder.applyMask(mask);
    builder.drawFormat(mask);
    const score = penalty(builder.modules);
    if (score < bestScore) { best = builder.modules; bestScore = score; }
  }
  return best as Matrix;
}
