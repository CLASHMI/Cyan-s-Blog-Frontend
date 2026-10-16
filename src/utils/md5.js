/* 管理员密钥的传输层摘要：明文口令在前端先做一次 MD5，网络里只出现 32 位小写十六进制。
   后端 application-dev.yml 里存的是「这段十六进制」的 BCrypt 值，两边都不落明文。
   注意 MD5 不是加密（不可逆），它只用于避免明文直传，真正的强度由后端 BCrypt 负责。 */

/* 每轮左旋位数（RFC 1321） */
const MD5_SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/* 常量表 T[i] = floor(abs(sin(i + 1)) × 2^32)，与标准表数值一致 */
const MD5_TABLE = new Uint32Array(64);
for (let i = 0; i < 64; i += 1) MD5_TABLE[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

/* 小端输出：四个状态字各自按低位在前拼成 8 位十六进制 */
function wordToHex(word) {
  let hex = "";
  for (let i = 0; i < 4; i += 1) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  return hex;
}

export function md5Hex(text) {
  /* 按字节计算：中文口令必须先转 UTF-8 字节，和后端对同一字符串的摘要一致 */
  const bytes = new TextEncoder().encode(String(text));
  const bitLength = bytes.length * 8;
  /* 补一个 0x80、补零到 56 mod 64、末尾塞 64 位小端长度 */
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

  let stateA = 0x67452301;
  let stateB = 0xefcdab89;
  let stateC = 0x98badcfe;
  let stateD = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const chunk = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) chunk[i] = view.getUint32(offset + i * 4, true);

    let a = stateA;
    let b = stateB;
    let c = stateC;
    let d = stateD;

    for (let i = 0; i < 64; i += 1) {
      let mix;
      let index;
      if (i < 16) {
        mix = (b & c) | (~b & d);
        index = i;
      } else if (i < 32) {
        mix = (d & b) | (~d & c);
        index = (5 * i + 1) % 16;
      } else if (i < 48) {
        mix = b ^ c ^ d;
        index = (3 * i + 5) % 16;
      } else {
        mix = c ^ (b | ~d);
        index = (7 * i) % 16;
      }
      const rotated = (a + mix + MD5_TABLE[i] + chunk[index]) >>> 0;
      const shift = MD5_SHIFT[i];
      const next = (b + (((rotated << shift) | (rotated >>> (32 - shift))) >>> 0)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }

    stateA = (stateA + a) >>> 0;
    stateB = (stateB + b) >>> 0;
    stateC = (stateC + c) >>> 0;
    stateD = (stateD + d) >>> 0;
  }

  return wordToHex(stateA) + wordToHex(stateB) + wordToHex(stateC) + wordToHex(stateD);
}
