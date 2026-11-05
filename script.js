"use strict";

// 브라우저는 인증키 없이 같은 사이트의 서버리스 함수만 호출합니다.
const API_URL = "/api/dust";
const $ = (id) => document.getElementById(id);
const grades = { "1": "좋음", "2": "보통", "3": "나쁨", "4": "매우나쁨" };
// 대표 상태에는 미세먼지 평균의 등급과 간단한 생활 안내를 사용합니다.
const signals = {
  "1": { emoji: "🔵", advice: "공기가 맑아요. 가까운 곳으로 가볍게 산책해 보세요." },
  "2": { emoji: "🟢", advice: "무난한 공기예요. 외출 전 가까운 측정소도 확인해 보세요." },
  "3": { emoji: "🟠", advice: "외출 시 마스크를 챙기고, 긴 야외 활동은 줄이세요." },
  "4": { emoji: "🔴", advice: "가급적 실내에서 지내고, 꼭 외출할 때는 마스크를 챙기세요." }
};
let activeController;

// 누락값과 잘못된 값은 제외하고 0을 포함한 유효한 숫자만 반환합니다.
function toNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

// 측정하지 못한 값에는 단위를 붙이지 않습니다.
function formatValue(value) {
  const number = toNumber(value);
  return number === null ? "측정 안 됨" : `${number} ㎍/㎥`;
}

// 반올림 전 미세먼지 평균에 좋음 30, 보통 80, 나쁨 150 기준을 적용합니다.
function getAverageGrade(average) {
  if (average === null) return "unknown";
  if (average <= 30) return "1";
  if (average <= 80) return "2";
  if (average <= 150) return "3";
  return "4";
}

// API의 한국 시각 문자열을 시간대 변환 없이 읽기 쉬운 한국어로 표시합니다.
function formatDataTime(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) return "측정 시각 정보 없음";
  const [, year, month, day, hour, minute] = match;
  const minutes = minute === "00" ? "" : ` ${Number(minute)}분`;
  return `${year}년 ${Number(month)}월 ${Number(day)}일 ${Number(hour)}시${minutes} 기준`;
}

// 조회 중, 누락, 오류 상태에서도 이전 지역의 신호등이 남지 않게 초기화합니다.
function setSignal(grade, label, emoji, advice) {
  $("summary").classList.remove("grade-1", "grade-2", "grade-3", "grade-4", "grade-unknown", "is-loading");
  $("summary").classList.add(`grade-${grade}`);
  $("signal-state").textContent = label;
  $("signal-emoji").textContent = emoji;
  $("air-advice").textContent = advice;
}

// 시도 이름만 서버로 전달하고 서버가 정리한 자료와 한국어 오류를 받습니다.
async function fetchStations(sidoName, signal) {
  const response = await fetch(`${API_URL}?sido=${encodeURIComponent(sidoName)}`, { signal });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("서버 응답을 확인할 수 없습니다. Vercel 배포 또는 로컬 개발 서버를 확인해주세요."); }
  if (!response.ok) {
    throw new Error(typeof data?.message === "string" ? data.message : "측정소 정보를 불러오지 못했습니다.");
  }
  if (!Array.isArray(data?.items)) {
    throw new Error("측정소 자료의 응답 형식이 올바르지 않습니다.");
  }
  return data.items;
}

// 유효한 미세먼지 값으로 측정소별 단순 평균을 계산합니다.
function renderStations(items) {
  const values = items.map((item) => toNumber(item.pm10Value)).filter((value) => value !== null);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const grade = getAverageGrade(average);
  if (average === null) {
    setSignal("unknown", "측정 안 됨", "⚪", "측정값이 아직 없어요. 잠시 후 다시 확인해 주세요.");
  } else {
    setSignal(grade, grades[grade], signals[grade].emoji, signals[grade].advice);
  }
  $("average").textContent = average === null ? "—" : average.toFixed(1);
  $("average-unit").hidden = values.length === 0;
  $("average-note").textContent = `전체 ${items.length}개 측정소 중 ${values.length}개 유효 측정값의 평균 · 누락값 제외`;
  const times = [...new Set(items.map((item) => String(item.dataTime ?? "").trim()))]
    .filter((time) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?$/.test(time)).sort();
  $("summary-time").textContent = times.length
    ? `${formatDataTime(times[times.length - 1])}${times.length > 1 ? " · 최신 측정 시각" : ""}`
    : "측정 시각 정보 없음";
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = $("station-template").content.firstElementChild.cloneNode(true);
    const grade = String(item.pm10Grade ?? "").trim();
    const known = Object.hasOwn(grades, grade);
    card.classList.add(known ? `grade-${grade}` : "grade-unknown");
    card.querySelector("h3").textContent = item.stationName || "이름 없는 측정소";
    card.querySelector(".badge").textContent = known ? grades[grade] : "등급 없음";
    card.querySelector(".pm10").textContent = formatValue(item.pm10Value);
    card.querySelector(".pm25").textContent = formatValue(item.pm25Value);
    card.querySelector(".measured-at").textContent = formatDataTime(item.dataTime);
    fragment.append(card);
  }
  $("stations").replaceChildren(fragment);
}

// 지역을 연속 변경하면 이전 요청을 취소해 선택한 지역의 결과만 표시합니다.
async function loadStations() {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const sidoName = $("sido").value;
  $("average-title").textContent = `${sidoName} · 평균 미세먼지 기준`;
  setSignal("unknown", "불러오는 중...", "⏳", "측정소의 공기 상태를 확인하고 있어요.");
  $("summary").classList.add("is-loading");
  $("summary").setAttribute("aria-busy", "true");
  $("average").textContent = "—";
  $("average-unit").hidden = true;
  $("average-note").textContent = "유효한 측정값만 모아 평균을 계산합니다.";
  $("summary-time").textContent = "측정 시각 확인 중";
  $("stations").replaceChildren();
  $("status").classList.remove("error");
  $("status").textContent = "불러오는 중...";
  $("stations").setAttribute("aria-busy", "true");
  $("refresh").disabled = true;
  // 응답이 지연될 때는 30초 후 취소하고 재시도할 수 있게 합니다.
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const items = await fetchStations(sidoName, controller.signal);
    if (controller !== activeController) return;
    renderStations(items);
    $("status").textContent = items.length ? `${sidoName} · ${items.length}개 측정소` : "이 지역의 측정소 자료가 없습니다.";
  } catch (error) {
    if (controller !== activeController) return;
    setSignal("unknown", "조회 실패", "⚪", "공기 상태를 가져오지 못했어요. 새로고침해 주세요.");
    $("average-note").textContent = "측정값을 불러오면 평균을 계산합니다.";
    $("summary-time").textContent = "측정 시각 정보 없음";
    $("status").classList.add("error");
    $("status").textContent = controller.signal.aborted
      ? "조회 시간이 초과되었습니다. 새로고침해 주세요."
      : error instanceof TypeError
        ? "연결에 실패했습니다. 인터넷 연결과 배포 서버 상태를 확인해주세요."
        : error.message;
  } finally {
    clearTimeout(timer);
    if (controller === activeController) {
      $("summary").setAttribute("aria-busy", "false");
      $("stations").setAttribute("aria-busy", "false");
      $("refresh").disabled = false;
    }
  }
}

// 처음 접속하거나 시도 선택 및 새로고침을 누르면 자료를 조회합니다.
$("sido").addEventListener("change", loadStations);
$("refresh").addEventListener("click", loadStations);
loadStations();
