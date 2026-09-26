export function maskName(name: string) {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return trimmed;
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${"*".repeat(trimmed.length - 1)}`;
}

export function maskPhone(phone: string) {
  return phone.replace(/(\d{2,3})[-\s]?(\d{3,4})[-\s]?(\d{4})/g, "$1-****-$3");
}

export function maskEmail(email: string) {
  return email.replace(/\b([A-Z0-9._%+-])[A-Z0-9._%+-]*(@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi, "$1***$2");
}

export function maskAccountNumber(text: string) {
  return text.replace(/\b(\d{2,6})[-\s]?(\d{2,6})[-\s]?(\d{2,8})[-\s]?(\d{2,8})\b/g, "$1-****-****-$4");
}

export function maskBusinessRegistrationNumber(text: string) {
  return text.replace(/\b(\d{3})[-\s]?(\d{2})[-\s]?(\d{5})\b/g, "$1-**-*****");
}

function maskResidentNumber(text: string) {
  return text.replace(/\b(\d{6})[-\s]?[1-4]\d{6}\b/g, "$1-*******");
}

function maskAddress(text: string) {
  return text.replace(/([가-힣]{2,}(?:시|군|구)\s+[가-힣0-9\s-]{2,})(\d{1,4}(?:-\d{1,4})?)/g, "$1****");
}

export function maskSensitiveText(text: string) {
  return maskAddress(maskBusinessRegistrationNumber(maskAccountNumber(maskResidentNumber(maskEmail(maskPhone(text)))))).replace(
    /\b([가-힣]{2,4})(님|고객|직원|대표)?\b/g,
    (match, name: string, suffix = "") => {
      if (
        [
          "배송",
          "발주",
          "재고",
          "문의",
          "보고",
          "승인",
          "고객",
          "직원",
          "대표",
          "거래처",
          "현장",
          "정보",
          "확인",
          "접수",
          "공식",
        ].includes(name)
      ) {
        return match;
      }

      return `${maskName(name)}${suffix}`;
    },
  );
}
