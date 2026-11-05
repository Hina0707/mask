"use strict";

// 인증키는 서버 환경변수에서만 읽고 브라우저에는 전달하지 않습니다.
const API_URL = "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty";
const SIDOS = new Set([
  "전국", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"
]);

// 외부 응답이나 오류 객체 대신 한국어 안내만 반환해 인증키 노출을 막습니다.
function upstreamError(message) {
  return Object.assign(new Error(message), { statusCode: 502 });
}

// Decoding 키를 정확히 한 번 인코딩하고 각 페이지를 조회합니다.
async function fetchPage(sido, pageNo, key, signal) {
  const url = `${API_URL}?serviceKey=${encodeURIComponent(key)}`
    + `&returnType=json&sidoName=${encodeURIComponent(sido)}`
    + `&numOfRows=100&pageNo=${pageNo}&ver=1.3`;
  const response = await fetch(url, { signal });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // XML 에러를 포함한 비정상 응답은 지정된 안내 메시지로 바꿉니다.
    throw upstreamError("인증키 또는 요청값을 확인해주세요");
  }

  const header = data?.response?.header;
  if (!header || String(header.resultCode) !== "00") {
    throw upstreamError("대기오염정보 조회에 실패했습니다. 인증키, 요청값, API 활용신청 상태와 호출 한도를 확인해주세요.");
  }
  if (!response.ok) {
    throw upstreamError("대기오염정보 서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  const body = data.response.body;
  const totalCount = Number(body?.totalCount);
  if (!Array.isArray(body?.items) || !Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw upstreamError("측정소 자료의 응답 형식이 올바르지 않습니다.");
  }
  return { items: body.items, totalCount };
}

// Vercel은 이 함수를 /api/dust 경로에서 실행합니다.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "조회 요청만 사용할 수 있습니다." });
  }

  const value = req.query?.sido;
  if (value !== undefined && typeof value !== "string") {
    return res.status(400).json({ message: "시도 이름은 하나만 입력해주세요." });
  }
  const sido = value?.trim() || "서울";
  if (!SIDOS.has(sido)) {
    return res.status(400).json({ message: "올바른 시도 이름을 입력해주세요." });
  }

  const key = process.env.AIRKOREA_KEY?.trim();
  if (!key) {
    return res.status(500).json({ message: "서버에 AIRKOREA_KEY 환경변수를 설정해주세요." });
  }

  // 전체 조회를 20초로 제한하고 성공 여부와 관계없이 타이머를 해제합니다.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const first = await fetchPage(sido, 1, key, controller.signal);
    const items = [...first.items];
    // 첫 100건 이후도 조회해 전국 및 큰 지역의 목록과 평균을 유지합니다.
    for (let page = 2; page <= Math.ceil(first.totalCount / 100); page++) {
      const next = await fetchPage(sido, page, key, controller.signal);
      items.push(...next.items);
    }
    if (items.length < first.totalCount) {
      throw upstreamError("일부 측정소 자료가 누락되었습니다. 새로고침해주세요.");
    }
    return res.status(200).json({ items, totalCount: items.length });
  } catch (error) {
    if (controller.signal.aborted) {
      return res.status(504).json({ message: "대기오염정보 조회 시간이 초과되었습니다. 다시 시도해주세요." });
    }
    return res.status(error.statusCode === 502 ? 502 : 500).json({
      message: error.statusCode === 502
        ? error.message
        : "대기오염정보 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요."
    });
  } finally {
    clearTimeout(timer);
  }
};
