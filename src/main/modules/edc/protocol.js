// Protocol constants
const STX = 0x02;
const ETX = 0x03;
const ACK = 0x06;
const NAK = 0x15;
const ENQ = 0x05;
const EOT = 0x04;
const FS = 0x1C;

function charToHex(c) {
  return c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
}

function stringToHexString(text) {
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    hex += charToHex(text[i]);
  }
  return hex;
}

function hexStringToString(hexStr) {
  let result = '';
  for (let i = 0; i < hexStr.length; i += 2) {
    const byte = parseInt(hexStr.substring(i, i + 2), 16);
    result += String.fromCharCode(byte);
  }
  return result;
}

function splitHexStringToList(hexStr) {
  const list = [];
  for (let i = 0; i < hexStr.length; i += 2) {
    list.push(hexStr.substring(i, i + 2));
  }
  return list;
}

function asciiStringToHex(asciiStr) {
  if (!asciiStr) return '';
  let result = '';
  for (let i = 0; i < asciiStr.length; i++) {
    result += asciiStr.charCodeAt(i).toString(16).toUpperCase().padStart(2, '0');
  }
  return result;
}

function formatNumberToDigitString(number, digits) {
  const intValue = Math.round(number * 100);
  return intValue.toString().padStart(digits, '0');
}

function formatStringToDigitString(text, digits, padChar = ' ') {
  return String(text || '').padStart(digits, padChar);
}

function numberDigitStringToString(numberDigit) {
  try {
    return (parseFloat(numberDigit) / 100).toFixed(2);
  } catch {
    return '0.00';
  }
}

function calcLength(length) {
  if (length <= 0) return '0000';
  return length.toString().padStart(4, '0');
}

function calculateXor(hexValues) {
  let xorResult = 0;
  for (const hex of hexValues) {
    xorResult ^= parseInt(hex, 16);
  }
  return xorResult.toString(16).toUpperCase().padStart(2, '0');
}

function messageDataLength(parts) {
  const combined = parts.join('');
  const hexList = splitHexStringToList(combined);
  return calcLength(hexList.length);
}

function packMessage(reserveHex, headerHex, fieldDataHexes) {
  const HEX_STX = '02';
  const HEX_ETX = '03';

  // Calculate length of message data (reserve + header + fields)
  const allParts = [reserveHex, headerHex, ...fieldDataHexes];
  const lengthHex = messageDataLength(allParts);

  // Pack: STX + LENGTH + data + ETX
  const messageParts = [HEX_STX, lengthHex, reserveHex, headerHex, ...fieldDataHexes, HEX_ETX];
  const messageHex = messageParts.join('');

  // Calculate LRC (XOR of all bytes)
  const hexList = splitHexStringToList(messageHex);
  const lrc = calculateXor(hexList);

  return messageHex + lrc;
}

function byteHexStringMessageData(hexString) {
  const hexList = splitHexStringToList(hexString);
  let result = '';
  for (const hex of hexList) {
    result += String.fromCharCode(parseInt(hex, 16));
  }
  return result;
}

function validateLrc(rawData) {
  if (!rawData || rawData.length < 2) return false;

  const hex = asciiStringToHex(rawData);
  const hexList = splitHexStringToList(hex);

  // Last byte is LRC, rest is the message
  const messagePart = hexList.slice(0, -1);
  const receivedLrc = hexList[hexList.length - 1];
  const calculatedLrc = calculateXor(messagePart);

  return calculatedLrc.toUpperCase() === receivedLrc.toUpperCase();
}

module.exports = {
  STX, ETX, ACK, NAK, ENQ, EOT, FS,
  charToHex,
  stringToHexString,
  hexStringToString,
  splitHexStringToList,
  asciiStringToHex,
  formatNumberToDigitString,
  formatStringToDigitString,
  numberDigitStringToString,
  calcLength,
  calculateXor,
  messageDataLength,
  packMessage,
  byteHexStringMessageData,
  validateLrc,
};
