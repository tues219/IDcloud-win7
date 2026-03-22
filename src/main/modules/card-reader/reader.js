function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatusWord(buffer) {
  if (!buffer || buffer.length < 2) {
    return { sw1: 0, sw2: 0, sw: '0000' };
  }
  const sw1 = buffer[buffer.length - 2];
  const sw2 = buffer[buffer.length - 1];
  const sw = ((sw1 << 8) | sw2).toString(16).padStart(4, '0');
  return { sw1, sw2, sw };
}

async function transmitWithTimeout(card, bytes, timeoutMs = 5000) {
  return Promise.race([
    card.transmit(Buffer.from(bytes)),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('COMMAND_TIMEOUT')), timeoutMs)
    )
  ]);
}

async function getData(card, command, req = [0x00, 0xc0, 0x00, 0x00], options = {}) {
  const { retries = 3, delayMs = 100, commandTimeout = 5000, isCancelled } = options;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    if (isCancelled && isCancelled()) throw new Error('CARD_REMOVED');
    try {
      const selectResponse = await transmitWithTimeout(
        card,
        command,
        commandTimeout
      );

      const selectSw = getStatusWord(selectResponse);
      let expectedLength = command.slice(-1)[0];

      if (selectSw.sw1 === 0x61) {
        expectedLength = selectSw.sw2;
      } else if (selectSw.sw1 === 0x6c) {
        expectedLength = selectSw.sw2;
      }

      const data = await transmitWithTimeout(
        card,
        [...req, expectedLength],
        commandTimeout
      );

      const dataSw = getStatusWord(data);
      if (dataSw.sw1 === 0x90 && dataSw.sw2 === 0x00) {
        return data;
      }
      if (dataSw.sw1 === 0x6c) {
        const corrected = await transmitWithTimeout(
          card,
          [...req, dataSw.sw2],
          commandTimeout
        );
        return corrected;
      }

      return data;
    } catch (err) {
      if (isCancelled && isCancelled()) throw new Error('CARD_REMOVED');
      lastError = err;
      if (attempt < retries) {
        const backoffMs = delayMs * Math.pow(2, attempt - 1);
        await delay(backoffMs);
      }
    }
  }

  throw lastError;
}

module.exports = { getData, delay, getStatusWord, transmitWithTimeout };
