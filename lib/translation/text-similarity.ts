export function computeTextSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (!normalizedLeft && !normalizedRight) {
    return 1;
  }

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  const distance = computeLevenshteinDistance(normalizedLeft, normalizedRight);
  const longestLength = Math.max(normalizedLeft.length, normalizedRight.length);

  return longestLength === 0 ? 1 : 1 - distance / longestLength;
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function computeLevenshteinDistance(left: string, right: string) {
  const previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previousRow[0];
    previousRow[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const temporary = previousRow[rightIndex];
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;

      previousRow[rightIndex] = Math.min(
        previousRow[rightIndex] + 1,
        previousRow[rightIndex - 1] + 1,
        diagonal + substitutionCost,
      );
      diagonal = temporary;
    }
  }

  return previousRow[right.length];
}
