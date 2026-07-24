import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, Image, Pressable, ScrollView, StyleSheet, Animated, Dimensions, AppState, Alert, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import Svg, { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import mobileAds, { TestIds, InterstitialAd, AdEventType } from 'react-native-google-mobile-ads';
import {
  initConnection as iapInitConnection, endConnection as iapEndConnection,
  fetchProducts, requestPurchase, purchaseUpdatedListener, purchaseErrorListener,
  finishTransaction, restorePurchases, getAvailablePurchases,
} from 'expo-iap';

/* ───────── 팔레트 (미니멀: 화이트/잉크 + 옐로 포인트) ───────── */
const C = {
  bg: '#FFFFFF',
  panel: '#FAFAF7',
  line: '#ECECE6',
  ink: '#1A1A1A',
  sub: '#A0A099',
  accent: '#F7C948',
  danger: '#FF6B5E',
};

/* ───────── 사운드 ───────── */
const PUNCH_SFX_OPTIONS = [
  { id: 'sfx1', name: '효과음 1', src: require('./assets/sounds/punch-soraatwod.mp3') },
  { id: 'sfx2', name: '효과음 2', src: require('./assets/sounds/hard-punch.mp3') },
];
// 연타 중 소리가 겹치므로 효과음별 플레이어 4개를 돌려가며 재생 (1개면 재생 중 seekTo가 소리를 끊는다)
const punchPools = {};
let punchPoolIdx = 0;
function playPunchSfx(id = 'sfx1', volume = 1) {
  try {
    const opt = PUNCH_SFX_OPTIONS.find(o => o.id === id) ?? PUNCH_SFX_OPTIONS[0];
    if (!punchPools[opt.id]) punchPools[opt.id] = Array.from({ length: 4 }, () => createAudioPlayer(opt.src));
    const p = punchPools[opt.id][punchPoolIdx++ % 4];
    p.volume = Math.max(0, Math.min(1, volume));
    p.seekTo(0);
    p.play();
  } catch (e) { /* 사운드 실패는 게임 진행에 영향 없음 */ }
}

/* BGM — 메인(수련)과 대련(도장깨기·샌드박스)에서 다른 곡을 루프 재생 */
const BGM_TRACKS = {
  main: require('./assets/sounds/bgm-main.mp3'),     // Lesiakower - Battle Time
  battle: require('./assets/sounds/bgm-battle.mp3'), // Retro-BGM-Chan - BOSS Battle Part2
};
// 핫 리로드로 모듈이 재평가돼도 기존 플레이어를 잃지 않도록 전역에 캐시
const bgmPlayers = globalThis.__ssalBgmPlayers ?? (globalThis.__ssalBgmPlayers = {});
let currentBgmKey = null;
function playBgm(key, volume) {
  try {
    if (currentBgmKey === key) { setBgmVolume(volume); return; }
    // 곡 전환 시 대상 외 플레이어는 정지 + 볼륨 0 — pause가 native에서 실패해도 겹쳐 들리지 않게
    Object.keys(bgmPlayers).forEach(k => {
      if (k !== key) {
        try { bgmPlayers[k].volume = 0; bgmPlayers[k].pause(); } catch (e) { /* noop */ }
      }
    });
    if (!bgmPlayers[key]) {
      const np = createAudioPlayer(BGM_TRACKS[key]);
      np.loop = true;
      // 일부 환경에서 loop 속성이 무시되는 문제 대비 — 곡이 끝나면 직접 되감아 재생
      np.addListener('playbackStatusUpdate', status => {
        if (status.didJustFinish && currentBgmKey === key) {
          try { np.seekTo(0); np.play(); } catch (e) { /* noop */ }
        }
      });
      bgmPlayers[key] = np;
    }
    const p = bgmPlayers[key];
    p.volume = Math.max(0, Math.min(1, volume));
    p.seekTo(0);
    p.play();
    currentBgmKey = key;
  } catch (e) { /* 사운드 실패는 게임 진행에 영향 없음 */ }
}
function setBgmVolume(volume) {
  // 현재 곡에만 사용자 볼륨 적용, 나머지는 항상 0 — 남은 곡이 어떤 상태든 무음 보장
  const v = Math.max(0, Math.min(1, volume));
  Object.keys(bgmPlayers).forEach(k => {
    try { bgmPlayers[k].volume = k === currentBgmKey ? v : 0; } catch (e) { /* noop */ }
  });
}

const ICONS = {
  gold: require('./assets/icons/icon_gold.png'),
  dojo: require('./assets/icons/icon_dojo.png'),
  tower: require('./assets/icons/icon_tower.png'),
  victory: require('./assets/icons/icon_victory.png'),
  defeat: require('./assets/icons/icon_defeat.png'),
  lock: require('./assets/icons/icon_lock.png'),
  clear: require('./assets/icons/icon_clear.png'),
  stun: require('./assets/icons/effect_stun.png'),
  breakBonus: require('./assets/icons/effect_break_bonus.png'),
  dodge: require('./assets/icons/effect_dodge.png'),
};

const EFFECTS = {
  impact: require('./assets/effects/effect_impact.png'),
  impactCrit: require('./assets/effects/effect_impact_crit.png'),
};

/* ───────── 스탯 (러닝타임 목표: 하루 8시간 × 3개월 — 비용 성장 가파르게) ───────── */
const STATS = {
  // 2026-07 전면 재조정: 코스트 배율을 낮추고 렙을 많이 사게(장르 관행), %스탯은 소폭+낮은 캡
  power:      { icon: require('./assets/icons/stat_power.png'), name: '손바닥 힘',     baseCost: 25,  costMul: 1.28 },
  hp:         { icon: require('./assets/icons/stat_hp.png'), name: '맷집',          baseCost: 50,  costMul: 1.28 },
  speed:      { icon: require('./assets/icons/stat_speed.png'), name: '손목 스냅',     baseCost: 100, costMul: 1.06, maxLv: 200 },
  // 회피/정타확률: 렙당 0.01%p 미세 성장 — 수천 렙짜리 초장기 골드 싱크 (배율 1.0015로 거의 평탄)
  dodge:      { icon: require('./assets/icons/stat_dodge.png'), name: '뺨 피하기',     baseCost: 120, costMul: 1.0015, maxLv: 8000 },
  critChance: { icon: require('./assets/icons/stat_crit.png'), name: '정타 확률',     baseCost: 90,  costMul: 1.0015, maxLv: 9500 },
  critDmg:    { icon: require('./assets/icons/stat_critdmg.png'), name: '정타 데미지',   baseCost: 110, costMul: 1.3,  maxLv: 40 },
};
const STAT_KEYS = Object.keys(STATS);

/* ───────── 비품 타겟 (업무용 "맞아주는 사무실 비품", 구매형 18티어) ───────── */
const BAGS = [
  { name: '스트레스볼',        cost: 0,        hp: 200,    goldMul: 1,     background: require('./assets/backgrounds/targets/target_01.png'), poses: { normal: require('./assets/targets/target_01_normal.png'), hit: require('./assets/targets/target_01_hit.png'), headback: require('./assets/targets/target_01_headback.png'), broken: require('./assets/targets/target_01_broken.png') } },
  { name: '뽁뽁이 뭉치',       cost: 8e3,      hp: 1.5e3,  goldMul: 1.6,   background: require('./assets/backgrounds/targets/target_02.png'), poses: { normal: require('./assets/targets/target_02_normal.png'), hit: require('./assets/targets/target_02_hit.png'), headback: require('./assets/targets/target_02_headback.png'), broken: require('./assets/targets/target_02_broken.png') } },
  { name: '회의실 방석',       cost: 1e5,      hp: 1.2e4,  goldMul: 2.6,   background: require('./assets/backgrounds/targets/target_03.png'), poses: { normal: require('./assets/targets/target_03_normal.png'), hit: require('./assets/targets/target_03_hit.png'), headback: require('./assets/targets/target_03_headback.png'), broken: require('./assets/targets/target_03_broken.png') } },
  { name: '탕비실 푸딩',       cost: 1.5e6,    hp: 1e5,    goldMul: 4,     background: require('./assets/backgrounds/targets/target_04.png'), poses: { normal: require('./assets/targets/target_04_normal.png'), hit: require('./assets/targets/target_04_hit.png'), headback: require('./assets/targets/target_04_headback.png'), broken: require('./assets/targets/target_04_broken.png') } },
  { name: '택배 상자',         cost: 2.5e7,    hp: 9e5,    goldMul: 6.5,   background: require('./assets/backgrounds/targets/target_05.png'), poses: { normal: require('./assets/targets/target_05_normal.png'), hit: require('./assets/targets/target_05_hit.png'), headback: require('./assets/targets/target_05_headback.png'), broken: require('./assets/targets/target_05_broken.png') } },
  { name: '결재 서류뭉치',     cost: 5e7,      hp: 2.7e6,  goldMul: 8.1,   background: require('./assets/backgrounds/targets/target_06.png'), poses: { normal: require('./assets/targets/target_06_normal.png'), hit: require('./assets/targets/target_06_hit.png'), headback: require('./assets/targets/target_06_headback.png'), broken: require('./assets/targets/target_06_broken.png') } },
  { name: '사내 헬스 짐볼',    cost: 1e8,      hp: 6.5e6,  goldMul: 10.2,  background: require('./assets/backgrounds/targets/target_07.png'), poses: { normal: require('./assets/targets/target_07_normal.png'), hit: require('./assets/targets/target_07_hit.png'), headback: require('./assets/targets/target_07_headback.png'), broken: require('./assets/targets/target_07_broken.png') } },
  { name: '정수기 물통',       cost: 2e8,      hp: 1.2e7,  goldMul: 12.7,  background: require('./assets/backgrounds/targets/target_08.png'), poses: { normal: require('./assets/targets/target_08_normal.png'), hit: require('./assets/targets/target_08_hit.png'), headback: require('./assets/targets/target_08_headback.png'), broken: require('./assets/targets/target_08_broken.png') } },
  { name: '사무실 화분',       cost: 4e8,      hp: 2.1e7,  goldMul: 15.9,  background: require('./assets/backgrounds/targets/target_09.png'), poses: { normal: require('./assets/targets/target_09_normal.png'), hit: require('./assets/targets/target_09_hit.png'), headback: require('./assets/targets/target_09_headback.png'), broken: require('./assets/targets/target_09_broken.png') } },
  { name: '복합기',            cost: 8e8,      hp: 3.7e7,  goldMul: 19.8,  background: require('./assets/backgrounds/targets/target_10.png'), poses: { normal: require('./assets/targets/target_10_normal.png'), hit: require('./assets/targets/target_10_hit.png'), headback: require('./assets/targets/target_10_headback.png'), broken: require('./assets/targets/target_10_broken.png') } },
  { name: '모니터',            cost: 1.6e9,    hp: 5.3e7,  goldMul: 24.8,  background: require('./assets/backgrounds/targets/target_11.png'), poses: { normal: require('./assets/targets/target_11_normal.png'), hit: require('./assets/targets/target_11_hit.png'), headback: require('./assets/targets/target_11_headback.png'), broken: require('./assets/targets/target_11_broken.png') } },
  { name: '추억의 샌드백',     cost: 3.2e9,    hp: 8.2e7,  goldMul: 31,    background: require('./assets/backgrounds/targets/target_12.png'), poses: { normal: require('./assets/targets/target_12_normal.png'), hit: require('./assets/targets/target_12_hit.png'), headback: require('./assets/targets/target_12_headback.png'), broken: require('./assets/targets/target_12_broken.png') } },
  { name: '자판기',            cost: 6.4e9,    hp: 1.15e8, goldMul: 38.7,  background: require('./assets/backgrounds/targets/target_13.png'), poses: { normal: require('./assets/targets/target_13_normal.png'), hit: require('./assets/targets/target_13_hit.png'), headback: require('./assets/targets/target_13_headback.png'), broken: require('./assets/targets/target_13_broken.png') } },
  { name: '경리부 금고',       cost: 1.28e10,  hp: 1.95e8, goldMul: 48.4,  background: require('./assets/backgrounds/targets/target_14.png'), poses: { normal: require('./assets/targets/target_14_normal.png'), hit: require('./assets/targets/target_14_hit.png'), headback: require('./assets/targets/target_14_headback.png'), broken: require('./assets/targets/target_14_broken.png') } },
  { name: '서버랙',            cost: 2.56e10,  hp: 2.8e8,  goldMul: 60.5,  background: require('./assets/backgrounds/targets/target_15.png'), poses: { normal: require('./assets/targets/target_15_normal.png'), hit: require('./assets/targets/target_15_hit.png'), headback: require('./assets/targets/target_15_headback.png'), broken: require('./assets/targets/target_15_broken.png') } },
  { name: '창업주 청동 흉상',  cost: 5.12e10,  hp: 4.3e8,  goldMul: 75.7,  background: require('./assets/backgrounds/targets/target_16.png'), poses: { normal: require('./assets/targets/target_16_normal.png'), hit: require('./assets/targets/target_16_hit.png'), headback: require('./assets/targets/target_16_headback.png'), broken: require('./assets/targets/target_16_broken.png') } },
  { name: '다이아 트로피',     cost: 1.024e11, hp: 5.8e8,  goldMul: 94.6,  background: require('./assets/backgrounds/targets/target_17.png'), poses: { normal: require('./assets/targets/target_17_normal.png'), hit: require('./assets/targets/target_17_hit.png'), headback: require('./assets/targets/target_17_headback.png'), broken: require('./assets/targets/target_17_broken.png') } },
  { name: '황금 회장 동상',    cost: 2.048e11, hp: 9e8,    goldMul: 118.2, background: require('./assets/backgrounds/targets/target_18.png'), poses: { normal: require('./assets/targets/target_18_normal.png'), hit: require('./assets/targets/target_18_hit.png'), headback: require('./assets/targets/target_18_headback.png'), broken: require('./assets/targets/target_18_broken.png') } },
];
const LEGACY_BAG_HP = [200, 1.5e3, 1.2e4, 1e5, 9e5, 8e6, 7e7, 6e8, 5e9, 4e10];
const BAG_SCHEMA_VERSION = 2;
const BAG_HIT_HOLD_MS = 50;
const BAG_HIT_THROTTLE_MS = 180;
const BAG_HEADBACK_MS = 120;   // 접촉 프레임 뒤 머리가 젖힌 상태를 유지하는 시간
const BAG_BREAK_MS = 800;      // 격파(X눈) 프레임 유지 + 입력 잠금 시간

/* ───────── 캐릭터 포즈 ─────────
 * Metro는 동적 require를 지원하지 않으므로 모든 프레임을 명시적으로 등록한다.
 */
const PLAYER_POSES = {
  idle: require('./assets/char/char_idle.png'),
  windupLeft: require('./assets/char/char_windup_left.png'),
  windupRight: require('./assets/char/char_windup_right.png'),
  slapLeft: require('./assets/char/char_slap_left.png'),
  slapRight: require('./assets/char/char_slap_right.png'),
  spin: require('./assets/char/char_spin.png'),
  hit: require('./assets/char/char_hit.png'),
  win: require('./assets/char/char_win.png'),
  dodge: require('./assets/char/char_dodge.png'),
};
// 공격은 2단 프레임: 크게 젖히는 windup → 풀스윙 slap (정타는 spin 팔로스루)
const PLAYER_ATTACK_POSES = ['windupLeft', 'windupRight', 'slapLeft', 'slapRight', 'spin'];

/* ───────── 스킨 ───────── */
const SKIN_IMG = {
  plain: require('./assets/skins/plain.png'),
  work_glove: require('./assets/skins/work_glove.png'),
  rubber_glove: require('./assets/skins/rubber_glove.png'),
  pasu: require('./assets/skins/pasu.png'),
  suit: require('./assets/skins/suit.png'),
  golf: require('./assets/skins/golf.png'),
  hiking: require('./assets/skins/hiking.png'),
  cyborg: require('./assets/skins/cyborg.png'),
  midas: require('./assets/skins/midas.png'),
  slap_king: require('./assets/skins/slap_king.png'),
};
// 가격은 비품 티어 비용 곡선(T4 1.5M ~ T16 51.2B)에 맞춰 배치, bonus는 골드 수입 배율(+%)
const SKINS = [
  { id: 'plain',        name: '새내기 인턴',           cost: 0,     bonus: 0,    desc: '인턴 티셔츠 · 목걸이 사원증' },
  { id: 'work_glove',   name: '물류팀 목장갑',         cost: 5e4,   bonus: 0.03, desc: '빨간 코팅 목장갑 세트' },
  { id: 'rubber_glove', name: '탕비실 고무장갑',       cost: 1e6,   bonus: 0.05, desc: '분홍 고무장갑 · 앞치마 세트' },
  { id: 'pasu',         name: '야근의 파스',           cost: 2e7,   bonus: 0.08, desc: '손바닥·뺨·어깨 파스 풀장착' },
  { id: 'suit',         name: '정장 대리룩',           cost: 6e7,   bonus: 0.11, desc: '셔츠+넥타이 · 소매 걷어붙임' },
  { id: 'golf',         name: '부장님 골프웨어',       cost: 1.2e8, bonus: 0.14, desc: '골프 장갑 · 챙모자 세트' },
  { id: 'hiking',       name: '임원 등산복',           cost: 2e8,   bonus: 0.18, desc: '고급 등산복 · 등산장갑 세트' },
  { id: 'cyborg',       name: '전산실 사이보그 핸드',  cost: 3e8,   bonus: 0.22, desc: '기계 의수 · 서버실 근무복' },
  { id: 'midas',        name: '황금 결재손',           cost: 5e9,   bonus: 0.26, desc: '황금 장갑 · 결재도장 세트' },
  { id: 'slap_king',    name: '전설의 슬랩왕 회장',    cost: 8e10,  bonus: 0.3,  desc: '챔피언 벨트 · 붉은 망토 · 회장 명패' },
];
/* 스킨별 전투 포즈 — Metro 제약으로 전부 정적 require. plain은 기존 PLAYER_POSES 사용(fallback 겸용) */
const SKIN_POSES = {
  work_glove: {
    idle: require('./assets/skins/poses/work_glove_idle.png'),
    windupLeft: require('./assets/skins/poses/work_glove_windup_left.png'),
    windupRight: require('./assets/skins/poses/work_glove_windup_right.png'),
    slapLeft: require('./assets/skins/poses/work_glove_slap_left.png'),
    slapRight: require('./assets/skins/poses/work_glove_slap_right.png'),
    spin: require('./assets/skins/poses/work_glove_spin.png'),
    hit: require('./assets/skins/poses/work_glove_hit.png'),
    dodge: require('./assets/skins/poses/work_glove_dodge.png'),
    win: require('./assets/skins/poses/work_glove_win.png'),
  },
  rubber_glove: {
    idle: require('./assets/skins/poses/rubber_glove_idle.png'),
    windupLeft: require('./assets/skins/poses/rubber_glove_windup_left.png'),
    windupRight: require('./assets/skins/poses/rubber_glove_windup_right.png'),
    slapLeft: require('./assets/skins/poses/rubber_glove_slap_left.png'),
    slapRight: require('./assets/skins/poses/rubber_glove_slap_right.png'),
    spin: require('./assets/skins/poses/rubber_glove_spin.png'),
    hit: require('./assets/skins/poses/rubber_glove_hit.png'),
    dodge: require('./assets/skins/poses/rubber_glove_dodge.png'),
    win: require('./assets/skins/poses/rubber_glove_win.png'),
  },
  pasu: {
    idle: require('./assets/skins/poses/pasu_idle.png'),
    windupLeft: require('./assets/skins/poses/pasu_windup_left.png'),
    windupRight: require('./assets/skins/poses/pasu_windup_right.png'),
    slapLeft: require('./assets/skins/poses/pasu_slap_left.png'),
    slapRight: require('./assets/skins/poses/pasu_slap_right.png'),
    spin: require('./assets/skins/poses/pasu_spin.png'),
    hit: require('./assets/skins/poses/pasu_hit.png'),
    dodge: require('./assets/skins/poses/pasu_dodge.png'),
    win: require('./assets/skins/poses/pasu_win.png'),
  },
  suit: {
    idle: require('./assets/skins/poses/suit_idle.png'),
    windupLeft: require('./assets/skins/poses/suit_windup_left.png'),
    windupRight: require('./assets/skins/poses/suit_windup_right.png'),
    slapLeft: require('./assets/skins/poses/suit_slap_left.png'),
    slapRight: require('./assets/skins/poses/suit_slap_right.png'),
    spin: require('./assets/skins/poses/suit_spin.png'),
    hit: require('./assets/skins/poses/suit_hit.png'),
    dodge: require('./assets/skins/poses/suit_dodge.png'),
    win: require('./assets/skins/poses/suit_win.png'),
  },
  golf: {
    idle: require('./assets/skins/poses/golf_idle.png'),
    windupLeft: require('./assets/skins/poses/golf_windup_left.png'),
    windupRight: require('./assets/skins/poses/golf_windup_right.png'),
    slapLeft: require('./assets/skins/poses/golf_slap_left.png'),
    slapRight: require('./assets/skins/poses/golf_slap_right.png'),
    spin: require('./assets/skins/poses/golf_spin.png'),
    hit: require('./assets/skins/poses/golf_hit.png'),
    dodge: require('./assets/skins/poses/golf_dodge.png'),
    win: require('./assets/skins/poses/golf_win.png'),
  },
  hiking: {
    idle: require('./assets/skins/poses/hiking_idle.png'),
    windupLeft: require('./assets/skins/poses/hiking_windup_left.png'),
    windupRight: require('./assets/skins/poses/hiking_windup_right.png'),
    slapLeft: require('./assets/skins/poses/hiking_slap_left.png'),
    slapRight: require('./assets/skins/poses/hiking_slap_right.png'),
    spin: require('./assets/skins/poses/hiking_spin.png'),
    hit: require('./assets/skins/poses/hiking_hit.png'),
    dodge: require('./assets/skins/poses/hiking_dodge.png'),
    win: require('./assets/skins/poses/hiking_win.png'),
  },
  cyborg: {
    idle: require('./assets/skins/poses/cyborg_idle.png'),
    windupLeft: require('./assets/skins/poses/cyborg_windup_left.png'),
    windupRight: require('./assets/skins/poses/cyborg_windup_right.png'),
    slapLeft: require('./assets/skins/poses/cyborg_slap_left.png'),
    slapRight: require('./assets/skins/poses/cyborg_slap_right.png'),
    spin: require('./assets/skins/poses/cyborg_spin.png'),
    hit: require('./assets/skins/poses/cyborg_hit.png'),
    dodge: require('./assets/skins/poses/cyborg_dodge.png'),
    win: require('./assets/skins/poses/cyborg_win.png'),
  },
  midas: {
    idle: require('./assets/skins/poses/midas_idle.png'),
    windupLeft: require('./assets/skins/poses/midas_windup_left.png'),
    windupRight: require('./assets/skins/poses/midas_windup_right.png'),
    slapLeft: require('./assets/skins/poses/midas_slap_left.png'),
    slapRight: require('./assets/skins/poses/midas_slap_right.png'),
    spin: require('./assets/skins/poses/midas_spin.png'),
    hit: require('./assets/skins/poses/midas_hit.png'),
    dodge: require('./assets/skins/poses/midas_dodge.png'),
    win: require('./assets/skins/poses/midas_win.png'),
  },
  slap_king: {
    idle: require('./assets/skins/poses/slap_king_idle.png'),
    windupLeft: require('./assets/skins/poses/slap_king_windup_left.png'),
    windupRight: require('./assets/skins/poses/slap_king_windup_right.png'),
    slapLeft: require('./assets/skins/poses/slap_king_slap_left.png'),
    slapRight: require('./assets/skins/poses/slap_king_slap_right.png'),
    spin: require('./assets/skins/poses/slap_king_spin.png'),
    hit: require('./assets/skins/poses/slap_king_hit.png'),
    dodge: require('./assets/skins/poses/slap_king_dodge.png'),
    win: require('./assets/skins/poses/slap_king_win.png'),
  },
};
// 스킨 포즈 우선, 없으면 기본 쌀알이 포즈로 fallback
const playerPoseSource = (skinId, pose) =>
  SKIN_POSES[skinId]?.[pose] ?? PLAYER_POSES[pose] ?? PLAYER_POSES.idle;

/* ───────── PvC: 승진 슬랩 (㈜곡물상사 직급 사다리 18관) ─────────
 * 관 클리어 = 승진. 포즈: idle/windup(예비동작)/attackLeftHand·RightHand(슬랩)/hit/dodge/ko
 */
const FOES = [
  { id: 'jopssal', name: '인턴 동기 좁쌀', background: require('./assets/backgrounds/foes/jopssal.png'), poses: {
    idle: require('./assets/foes/jopssal_idle.png'), windup: require('./assets/foes/jopssal_windup.png'), attackLeftHand: require('./assets/foes/jopssal_slap_left.png'), attackRightHand: require('./assets/foes/jopssal_slap_right.png'), hit: require('./assets/foes/jopssal_hit.png'), dodge: require('./assets/foes/jopssal_dodge.png'), ko: require('./assets/foes/jopssal_ko.png'),
  } },
  { id: 'barley', name: '수습사원 보리', background: require('./assets/backgrounds/foes/barley.png'), poses: {
    idle: require('./assets/foes/barley_idle.png'), windup: require('./assets/foes/barley_windup.png'), attackLeftHand: require('./assets/foes/barley_slap_left.png'), attackRightHand: require('./assets/foes/barley_slap_right.png'), hit: require('./assets/foes/barley_hit.png'), dodge: require('./assets/foes/barley_dodge.png'), ko: require('./assets/foes/barley_ko.png'),
  } },
  { id: 'corn', name: '사원 옥수수', background: require('./assets/backgrounds/foes/corn.png'), poses: {
    idle: require('./assets/foes/corn_idle.png'), windup: require('./assets/foes/corn_windup.png'), attackLeftHand: require('./assets/foes/corn_slap_left.png'), attackRightHand: require('./assets/foes/corn_slap_right.png'), hit: require('./assets/foes/corn_hit.png'), dodge: require('./assets/foes/corn_dodge.png'), ko: require('./assets/foes/corn_ko.png'),
  } },
  { id: 'potato', name: '주임 감자', background: require('./assets/backgrounds/foes/potato.png'), poses: {
    idle: require('./assets/foes/potato_idle.png'), windup: require('./assets/foes/potato_windup.png'), attackLeftHand: require('./assets/foes/potato_slap_left.png'), attackRightHand: require('./assets/foes/potato_slap_right.png'), hit: require('./assets/foes/potato_hit.png'), dodge: require('./assets/foes/potato_dodge.png'), ko: require('./assets/foes/potato_ko.png'),
  } },
  { id: 'sweetpotato', name: '대리 고구마', background: require('./assets/backgrounds/foes/sweetpotato.png'), poses: {
    idle: require('./assets/foes/sweetpotato_idle.png'), windup: require('./assets/foes/sweetpotato_windup.png'), attackLeftHand: require('./assets/foes/sweetpotato_slap_left.png'), attackRightHand: require('./assets/foes/sweetpotato_slap_right.png'), hit: require('./assets/foes/sweetpotato_hit.png'), dodge: require('./assets/foes/sweetpotato_dodge.png'), ko: require('./assets/foes/sweetpotato_ko.png'),
  } },
  { id: 'wheat', name: '선임 대리 밀', background: require('./assets/backgrounds/foes/wheat.png'), poses: {
    idle: require('./assets/foes/wheat_idle.png'), windup: require('./assets/foes/wheat_windup.png'), attackLeftHand: require('./assets/foes/wheat_slap_left.png'), attackRightHand: require('./assets/foes/wheat_slap_right.png'), hit: require('./assets/foes/wheat_hit.png'), dodge: require('./assets/foes/wheat_dodge.png'), ko: require('./assets/foes/wheat_ko.png'),
  } },
  { id: 'pea', name: '과장 완두콩', background: require('./assets/backgrounds/foes/pea.png'), poses: {
    idle: require('./assets/foes/pea_idle.png'), windup: require('./assets/foes/pea_windup.png'), attackLeftHand: require('./assets/foes/pea_slap_left.png'), attackRightHand: require('./assets/foes/pea_slap_right.png'), hit: require('./assets/foes/pea_hit.png'), dodge: require('./assets/foes/pea_dodge.png'), ko: require('./assets/foes/pea_ko.png'),
  } },
  { id: 'peanut', name: '차장 땅콩', background: require('./assets/backgrounds/foes/peanut.png'), poses: {
    idle: require('./assets/foes/peanut_idle.png'), windup: require('./assets/foes/peanut_windup.png'), attackLeftHand: require('./assets/foes/peanut_slap_left.png'), attackRightHand: require('./assets/foes/peanut_slap_right.png'), hit: require('./assets/foes/peanut_hit.png'), dodge: require('./assets/foes/peanut_dodge.png'), ko: require('./assets/foes/peanut_ko.png'),
  } },
  { id: 'walnut', name: '팀장 호두', background: require('./assets/backgrounds/foes/walnut.png'), poses: {
    idle: require('./assets/foes/walnut_idle.png'), windup: require('./assets/foes/walnut_windup.png'), attackLeftHand: require('./assets/foes/walnut_slap_left.png'), attackRightHand: require('./assets/foes/walnut_slap_right.png'), hit: require('./assets/foes/walnut_hit.png'), dodge: require('./assets/foes/walnut_dodge.png'), ko: require('./assets/foes/walnut_ko.png'),
  } },
  { id: 'brownrice', name: '부장 현미', background: require('./assets/backgrounds/foes/brownrice.png'), poses: {
    idle: require('./assets/foes/brownrice_idle.png'), windup: require('./assets/foes/brownrice_windup.png'), attackLeftHand: require('./assets/foes/brownrice_slap_left.png'), attackRightHand: require('./assets/foes/brownrice_slap_right.png'), hit: require('./assets/foes/brownrice_hit.png'), dodge: require('./assets/foes/brownrice_dodge.png'), ko: require('./assets/foes/brownrice_ko.png'),
  } },
  { id: 'blackrice', name: '실장 흑미', background: require('./assets/backgrounds/foes/blackrice.png'), poses: {
    idle: require('./assets/foes/blackrice_idle.png'), windup: require('./assets/foes/blackrice_windup.png'), attackLeftHand: require('./assets/foes/blackrice_slap_left.png'), attackRightHand: require('./assets/foes/blackrice_slap_right.png'), hit: require('./assets/foes/blackrice_hit.png'), dodge: require('./assets/foes/blackrice_dodge.png'), ko: require('./assets/foes/blackrice_ko.png'),
  } },
  { id: 'chapssal', name: '본부장 찹쌀', background: require('./assets/backgrounds/foes/chapssal.png'), poses: {
    idle: require('./assets/foes/chapssal_idle.png'), windup: require('./assets/foes/chapssal_windup.png'), attackLeftHand: require('./assets/foes/chapssal_slap_left.png'), attackRightHand: require('./assets/foes/chapssal_slap_right.png'), hit: require('./assets/foes/chapssal_hit.png'), dodge: require('./assets/foes/chapssal_dodge.png'), ko: require('./assets/foes/chapssal_ko.png'),
  } },
  { id: 'nurungji', name: '이사 누룽지', background: require('./assets/backgrounds/foes/nurungji.png'), poses: {
    idle: require('./assets/foes/nurungji_idle.png'), windup: require('./assets/foes/nurungji_windup.png'), attackLeftHand: require('./assets/foes/nurungji_slap_left.png'), attackRightHand: require('./assets/foes/nurungji_slap_right.png'), hit: require('./assets/foes/nurungji_hit.png'), dodge: require('./assets/foes/nurungji_dodge.png'), ko: require('./assets/foes/nurungji_ko.png'),
  } },
  { id: 'riceball', name: '상무 주먹밥', background: require('./assets/backgrounds/foes/riceball.png'), poses: {
    idle: require('./assets/foes/riceball_idle.png'), windup: require('./assets/foes/riceball_windup.png'), attackLeftHand: require('./assets/foes/riceball_slap_left.png'), attackRightHand: require('./assets/foes/riceball_slap_right.png'), hit: require('./assets/foes/riceball_hit.png'), dodge: require('./assets/foes/riceball_dodge.png'), ko: require('./assets/foes/riceball_ko.png'),
  } },
  { id: 'gimbap', name: '전무 김밥', background: require('./assets/backgrounds/foes/gimbap.png'), poses: {
    idle: require('./assets/foes/gimbap_idle.png'), windup: require('./assets/foes/gimbap_windup.png'), attackLeftHand: require('./assets/foes/gimbap_slap_left.png'), attackRightHand: require('./assets/foes/gimbap_slap_right.png'), hit: require('./assets/foes/gimbap_hit.png'), dodge: require('./assets/foes/gimbap_dodge.png'), ko: require('./assets/foes/gimbap_ko.png'),
  } },
  { id: 'garaetteok', name: '부사장 가래떡', background: require('./assets/backgrounds/foes/garaetteok.png'), poses: {
    idle: require('./assets/foes/garaetteok_idle.png'), windup: require('./assets/foes/garaetteok_windup.png'), attackLeftHand: require('./assets/foes/garaetteok_slap_left.png'), attackRightHand: require('./assets/foes/garaetteok_slap_right.png'), hit: require('./assets/foes/garaetteok_hit.png'), dodge: require('./assets/foes/garaetteok_dodge.png'), ko: require('./assets/foes/garaetteok_ko.png'),
  } },
  { id: 'injeolmi', name: '사장 인절미', background: require('./assets/backgrounds/foes/injeolmi.png'), poses: {
    idle: require('./assets/foes/injeolmi_idle.png'), windup: require('./assets/foes/injeolmi_windup.png'), attackLeftHand: require('./assets/foes/injeolmi_slap_left.png'), attackRightHand: require('./assets/foes/injeolmi_slap_right.png'), hit: require('./assets/foes/injeolmi_hit.png'), dodge: require('./assets/foes/injeolmi_dodge.png'), ko: require('./assets/foes/injeolmi_ko.png'),
  } },
  { id: 'ricebag_king', name: '회장 쌀포대 슬랩왕', background: require('./assets/backgrounds/foes/ricebag_king.png'), poses: {
    idle: require('./assets/foes/ricebag_king_idle.png'), windup: require('./assets/foes/ricebag_king_windup.png'), attackLeftHand: require('./assets/foes/ricebag_king_slap_left.png'), attackRightHand: require('./assets/foes/ricebag_king_slap_right.png'), hit: require('./assets/foes/ricebag_king_hit.png'), dodge: require('./assets/foes/ricebag_king_dodge.png'), ko: require('./assets/foes/ricebag_king_ko.png'), guard: require('./assets/foes/ricebag_king_guard.png'), special: require('./assets/foes/ricebag_king_special.png'), taunt: require('./assets/foes/ricebag_king_taunt.png'),
  } },
];
const PVC_STAGES = 18; // 18관 완결형 — 직급 사다리 18명 1:1, 반복 없음
// 플레이어 직급 표기 — pvcStage(클리어 관 수) 기준. 상대를 이기면 그 자리를 빼앗는다.
const PLAYER_RANKS = ['신입 인턴', '수습사원', '사원', '주임', '대리', '선임 대리', '과장', '차장', '팀장', '부장', '실장', '본부장', '이사', '상무', '전무', '부사장', '사장', '회장', '슬랩왕 회장'];
const pvcFoe = i => {
  const base = FOES[i % FOES.length];
  const round = Math.floor(i / FOES.length);
  return {
    id: base.id,
    name: round ? `${base.name} ${round + 1}단` : base.name,
    img: base.poses.idle,
    poses: base.poses,
    background: base.background,
    // 성장 곡선(2026-07 v2): 시뮬 기준 활성 1h≈5관, 8h≈7관, 24h≈8관, 1주≈9~10관 페이스.
    // 보상은 해당 관 첫 격파 시점 수련 5~10분어치.
    // 18관 완결 곡선(2026-07 v3): 시뮬 기준 첫날 ~6관, 24h 누적 ~10관, 활성 1주(현실 3~4주) 18관 클리어
    hp: Math.round(600 * Math.pow(1.6, i)),
    dmg: Math.round(10 * Math.pow(1.3, i)),
    crit: 5 + i * 2,
    // 회피 성공 시 즉시 반격하므로 회피율이 곧 난이도 — 무지성 연타 견제
    dodge: Math.min(60, 40 + i),
    critMul: 1.8,
    reward: Math.round(2e4 * Math.pow(1.7, i)),
  };
};

/* ───────── 인앱 결제 상품 (StoreKit/Play Billing 실결제) ─────────
 * sku는 스토어 콘솔(ASC/Play)에 등록한 상품 ID와 일치해야 한다.
 * price는 스토어 연결 전 표시용 폴백 — 실제 표시는 스토어의 displayPrice 우선.
 */
const BUFF_DURATION_MS = 2 * 3600 * 1000;
const IAP_SKU_PREFIX = 'app.ssalslap.mobile.';
const IAP_PRODUCTS = [
  { id: 'ad_free',  sku: IAP_SKU_PREFIX + 'ad_free',  consumable: false, icon: '🚫', name: '광고 제거',            price: '₩9,900', desc: '전면 광고가 영구히 사라져요' },
  { id: 'gold_x2',  sku: IAP_SKU_PREFIX + 'gold_x2',  consumable: true,  icon: '💰', name: '골드 2배 (2시간)',     price: '₩3,900', desc: '2시간 동안 모든 골드 획득 2배' },
  { id: 'one_shot', sku: IAP_SKU_PREFIX + 'one_shot', consumable: true,  icon: '✋', name: '비품 한 방에 박살 (2시간)', price: '₩6,900', desc: '2시간 동안 비품이 한 대에 박살나요' },
];
const AD_FREE_SKU = IAP_SKU_PREFIX + 'ad_free';

/* ───────── 광고 (AdMob, 전면 광고만 — 배너 없음) ─────────
 * 검술왕용 AdMob 앱·광고 단위 미발급 — 출시 전 AdMob에 새 앱 등록 후 실 ID로 교체할 것.
 * 그 전까지는 릴리즈 빌드도 구글 공식 테스트 광고 단위를 사용한다 (제재 위험 없음).
 */
const AD_UNIT_INTERSTITIAL = __DEV__
  ? TestIds.INTERSTITIAL
  : Platform.select({
      ios: 'ca-app-pub-8467967363800822/5792957116',
      android: 'ca-app-pub-8467967363800822/7944211800',
    });
const goldBoostActive = S => Date.now() < S.goldBoostUntil;
const oneShotActive   = S => Date.now() < S.oneShotUntil;
const fmtRemain = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const DEFAULT_STATE = {
  gold: 0,
  punches: 0,
  bagLevel: 0,     // 최고 보유 티어
  activeBag: 0,    // 수련에 사용 중인 티어 (보유 티어 중 선택)
  bagHp: BAGS[0].hp,
  bagSchemaVersion: BAG_SCHEMA_VERSION,
  lv: { power: 0, hp: 0, speed: 0, dodge: 0, critChance: 0, critDmg: 0 },
  skin: 'plain',
  ownedSkins: ['plain'],
  pvcStage: 0,
  punchSfx: 'sfx1',
  sfxVolume: 1,
  bgmVolume: 0.6,
  adFree: false,
  goldBoostUntil: 0, // 골드 2배 버프 만료 시각 (epoch ms)
  oneShotUntil: 0,   // 샌드백 한 방 버프 만료 시각 (epoch ms)
};

/* ───────── 수치 계산 ───────── */
const baseDamage = S => Math.round(5 * Math.pow(1.08, S.lv.power) + S.lv.power * 2);
// 자동 펀치: 렙당 +0.01회/초, 초당 2회 캡 — 피격 연출(헤드백 150ms/스로틀 180ms) 한계 준수
const autoPerSec = S => Math.min(2, S.lv.speed * 0.01);
const dodgePct   = S => Math.min(80, S.lv.dodge * 0.01);
const critPct    = S => Math.min(100, 5 + S.lv.critChance * 0.01);
const critMul    = S => 2 + S.lv.critDmg * 0.05;
const statCost   = (S, k) => Math.round(STATS[k].baseCost * Math.pow(STATS[k].costMul, S.lv[k]));
const skinBonus  = S => 1 + (SKINS.find(s => s.id === S.skin)?.bonus ?? 0);
// 체력은 힘과 완전 분리 (기존엔 baseDamage×3이 섞여 힘 올리면 체력도 오르는 문제)
const playerMaxHp = S => Math.round(100 * Math.pow(1.08, S.lv.hp) + S.lv.hp * 30);
const POSE_PRIORITY = { idle: 0, attack: 1, reaction: 2, terminal: 3 };
const posePriority = pose => {
  if (pose === 'win' || pose === 'ko') return POSE_PRIORITY.terminal;
  if (pose === 'hit' || pose === 'dodge') return POSE_PRIORITY.reaction;
  if (PLAYER_ATTACK_POSES.includes(pose) || pose === 'windup' || pose === 'attackLeftHand' || pose === 'attackRightHand') return POSE_PRIORITY.attack;
  return POSE_PRIORITY.idle;
};
const LETHAL_ATTACK_HOLD_MS = 180;
/* 과장 연출 상수 — 타격 순간 잠깐 멈칫(히트스톱), 정타는 더 길게 */
const HIT_STOP_MS = 40;
const HIT_STOP_CRIT_MS = 70;
const PLAYER_WINDUP_MS = 95;
const PLAYER_SWING_MS = 55;
const PLAYER_CONTACT_MS = PLAYER_WINDUP_MS + PLAYER_SWING_MS;
const PLAYER_FOLLOW_THROUGH_MS = 45;
const PLAYER_RECOVERY_MS = 120;
const PLAYER_ATTACK_QUEUE_LIMIT = 4;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// 골드는 데미지의 0.75제곱 — 데미지 성장 대비 수입은 완만하게
const goldFor = (S, dmg) => Math.max(1, Math.round(Math.pow(dmg, 0.75) * BAGS[S.activeBag].goldMul * skinBonus(S) * (goldBoostActive(S) ? 2 : 1)));
const powerScore = S => Math.round(baseDamage(S) * (1 + critPct(S) / 100 * (critMul(S) - 1)) * (1 + dodgePct(S) / 150));

const statDesc = {
  power:      S => `슬랩 데미지 ${fmt(baseDamage(S))}`,
  hp:         S => `승진 슬랩 체력 ${fmt(playerMaxHp(S))}`,
  speed:      S => `자동 슬랩 초당 ${parseFloat(autoPerSec(S).toFixed(2))}회 (최대 2회)`,
  dodge:      S => `회피 ${parseFloat(dodgePct(S).toFixed(2))}% (최대 80%)`,
  critChance: S => `정타 확률 ${parseFloat(critPct(S).toFixed(2))}% (최대 100%)`,
  critDmg:    S => `정타 ${parseFloat(critMul(S).toFixed(2))}배`,
};

// 방치형 표준 단위: 1.23K, 45.6M, 7.89B, ... 소수점 둘째 자리까지 반올림, 뒤 0 제거.
// Q(1e15) 이후엔 aa, ab, ac... 로 무한 확장 — 가수부가 항상 1000 미만이라 지수표기(e+)가 절대 안 나옴
const FMT_UNITS = ['K', 'M', 'B', 'T', 'Q'];
function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return String(Math.floor(n));
  let u = -1;
  while (n >= 1000) { n /= 1000; u++; }
  const unit = u < FMT_UNITS.length
    ? FMT_UNITS[u]
    : String.fromCharCode(97 + Math.floor((u - FMT_UNITS.length) / 26)) + String.fromCharCode(97 + (u - FMT_UNITS.length) % 26);
  return parseFloat(n.toFixed(2)) + unit;
}

const iconSt = StyleSheet.create({
  label: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

/* 설정 아이콘 — assets/icons/pacle_settings.svg (파클 공용 아이콘) 인라인 */
function SettingsIcon({ size = 24, color = C.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128">
      {/* 기어 패스 실범위(x 6~104, y 22~115) 중심에 정렬 — viewBox 중심(64,64)이면 우상단으로 치우쳐 보임 */}
      <SvgCircle fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" cx={55} cy={68.5} r={14} />
      <SvgPath fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round"
        d="M64 22 L69 35 Q76 37 81 41 L95 37 L104 52 L94 62 Q95 68 94 74 L104 84 L95 99 L81 95 Q76 100 69 102 L64 115 L46 115 L41 102 Q34 100 29 96 L15 100 L6 84 L16 74 Q15 68 16 62 L6 52 L15 37 L29 41 Q34 37 41 35 L46 22 Z" />
    </Svg>
  );
}

function GoldLabel({ children, style, textStyle, iconSize = 16 }) {
  return (
    <View style={[iconSt.label, style]}>
      <Image source={ICONS.gold} style={{ width: iconSize, height: iconSize }} resizeMode="contain" />
      <Text style={textStyle}>{children}</Text>
    </View>
  );
}

/* ───────── 떠오르는 텍스트 ───────── */
let floatSeq = 0;
const FLOAT_COLOR = { normal: C.ink, crit: C.danger, info: '#5B8DEF', bonus: '#C99700' };
const FLOAT_SIZE  = { normal: 22, crit: 32, info: 20, bonus: 28 };

function FloatingText({ item, onDone }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true })
      .start(() => onDone(item.id));
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left: item.x, top: item.y, zIndex: 30,
        flexDirection: 'row', alignItems: 'center', gap: 5,
        opacity: anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -110] }) },
          { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.6] }) },
        ],
      }}>
      {item.icon && (
        <Image
          source={item.icon}
          style={{ width: FLOAT_SIZE[item.type], height: FLOAT_SIZE[item.type] }}
          resizeMode="contain"
        />
      )}
      <Text style={{ fontWeight: '900', color: FLOAT_COLOR[item.type], fontSize: FLOAT_SIZE[item.type] }}>
        {item.text}
      </Text>
    </Animated.View>
  );
}

/* ───────── 메인 앱 ───────── */
export default function App() {
  return (
    <SafeAreaProvider>
      <Game />
    </SafeAreaProvider>
  );
}

function Game() {
  const insets = useSafeAreaInsets();
  const S = useRef({ ...DEFAULT_STATE, lv: { ...DEFAULT_STATE.lv }, ownedSkins: ['plain'] }).current;
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick(t => t + 1), []);
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  const [tab, setTab] = useState('stats');
  const [floats, setFloats] = useState([]);
  const [warning, setWarning] = useState(false);
  const [stunned, setStunned] = useState(false);
  const [battle, setBattle] = useState(null);
  const inBattle = battle !== null;
  const [playerPose, setPlayerPose] = useState('idle');
  const [foePose, setFoePose] = useState('idle');
  const [bagPose, setBagPose] = useState('normal');
  const [impactCrit, setImpactCrit] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [foePickerOpen, setFoePickerOpen] = useState(false); // 샌드박스 상대 교체 드롭박스
  const [showSettings, setShowSettings] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const bagBreakCount = useRef(0); // 샌드백 격파 20회마다 전면 광고
  const interstitialRef = useRef(null);
  const interstitialLoaded = useRef(false);
  const [iapProducts, setIapProducts] = useState({}); // sku → 스토어 상품 (displayPrice 등)
  const iapBusy = useRef(false);
  const stunnedUntil = useRef(0);
  const warningRef = useRef(false);
  const warningStartedAt = useRef(0);
  const punchedInWarningRef = useRef(false);

  const charAnim = useRef(new Animated.Value(0)).current;
  const bagAnim = useRef(new Animated.Value(0)).current;
  const foeAnim = useRef(new Animated.Value(0)).current;
  const playerIdleAnim = useRef(new Animated.Value(0)).current;
  const foeIdleAnim = useRef(new Animated.Value(0)).current;
  // 과장 연출: 무대 전체 흔들림(px)·줌 펀치인·정타 화면 플래시
  const stageShake = useRef(new Animated.Value(0)).current;
  const stageZoom = useRef(new Animated.Value(1)).current;
  const flashAnim = useRef(new Animated.Value(0)).current;
  const impactAnim = useRef(new Animated.Value(0)).current;
  const attackPhaseTimer = useRef(null); // windup → slap 프레임 전환 타이머
  const playerContactTimer = useRef(null);
  const playerFollowTimer = useRef(null);
  const playerRecoveryTimer = useRef(null);
  const foePhaseTimer = useRef(null);
  const foeContactTimer = useRef(null);
  const foeRecoveryTimer = useRef(null);
  const playerPoseTimer = useRef(null);
  const foePoseTimer = useRef(null);
  const foeCounterTimers = useRef(new Set());
  const foeCounterRetryTimer = useRef(null);
  const pendingFoeCounters = useRef(0);
  const drainFoeCounterRef = useRef(null);
  const bagPoseTimer = useRef(null);
  const bagBreakTimer = useRef(null);
  const bagBrokenRef = useRef(false);
  const lastBagHitAt = useRef(0);
  const resultTimer = useRef(null);
  const playerPoseRef = useRef('idle');
  const foePoseRef = useRef('idle');
  const playerPosePriorityRef = useRef(POSE_PRIORITY.idle);
  const foePosePriorityRef = useRef(POSE_PRIORITY.idle);
  const playerAttackIndex = useRef(0);
  const foeAttackHandIndex = useRef(0);
  const playerAttackLocked = useRef(false);
  const foeAttackLocked = useRef(false);
  const pendingPlayerAttacks = useRef([]);
  const playPlayerAttackRef = useRef(null);
  const playerAttackBeforeContact = useRef(false);
  const foeAttackBeforeContact = useRef(false);
  const pendingPlayerReaction = useRef(null);
  const pendingFoeReaction = useRef(null);
  const playerReactionNowRef = useRef(null);
  const foeReactionNowRef = useRef(null);

  const clearFoeCounterWork = useCallback(() => {
    foeCounterTimers.current.forEach(timer => clearTimeout(timer));
    foeCounterTimers.current.clear();
    clearTimeout(foeCounterRetryTimer.current);
    foeCounterRetryTimer.current = null;
    pendingFoeCounters.current = 0;
  }, []);

  /* 저장/불러오기 */
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem('ssal-slap')
      .then(raw => {
        if (raw) {
          try {
            const d = JSON.parse(raw);
            const savedBagLevel = Number.isFinite(d.bagLevel) ? Math.trunc(d.bagLevel) : 0;
            const savedBagHp = d.bagHp;
            Object.assign(S, DEFAULT_STATE, d, { lv: { ...DEFAULT_STATE.lv, ...(d.lv || {}) } });
            // 저장된 스킨 ID 검증 — 유효하지 않을 때만 plain 처리
            S.ownedSkins = Array.isArray(S.ownedSkins)
              ? S.ownedSkins.filter(id => SKINS.some(s => s.id === id))
              : [];
            if (!S.ownedSkins.includes('plain')) S.ownedSkins.unshift('plain');
            if (!SKINS.some(s => s.id === S.skin) || !S.ownedSkins.includes(S.skin)) S.skin = 'plain';
            if (!PUNCH_SFX_OPTIONS.some(o => o.id === S.punchSfx)) S.punchSfx = 'sfx1';
            S.sfxVolume = Number.isFinite(S.sfxVolume) ? Math.max(0, Math.min(1, S.sfxVolume)) : 1;
            S.bgmVolume = Number.isFinite(S.bgmVolume) ? Math.max(0, Math.min(1, S.bgmVolume)) : 0.6;
            S.adFree = S.adFree === true;
            S.goldBoostUntil = Number.isFinite(S.goldBoostUntil) ? S.goldBoostUntil : 0;
            S.oneShotUntil = Number.isFinite(S.oneShotUntil) ? S.oneShotUntil : 0;
            S.bagLevel = Math.max(0, Math.min(savedBagLevel, BAGS.length - 1));
            // 기존 저장(activeBag 없음)은 최고 티어를 사용 중이던 것으로 간주
            S.activeBag = Number.isFinite(d.activeBag)
              ? Math.max(0, Math.min(Math.trunc(d.activeBag), S.bagLevel))
              : S.bagLevel;
            const newBagMaxHp = BAGS[S.activeBag].hp;
            if (!Number.isFinite(savedBagHp) || savedBagHp <= 0) {
              S.bagHp = newBagMaxHp;
            } else if (d.bagSchemaVersion === BAG_SCHEMA_VERSION) {
              S.bagHp = Math.max(1, Math.min(Math.round(savedBagHp), newBagMaxHp));
            } else {
              const legacyBagMaxHp = LEGACY_BAG_HP[S.activeBag] ?? newBagMaxHp;
              const hpRatio = Math.max(0, Math.min(savedBagHp / legacyBagMaxHp, 1));
              S.bagHp = Math.max(1, Math.round(newBagMaxHp * hpRatio));
            }
            S.bagSchemaVersion = BAG_SCHEMA_VERSION;
          } catch (e) { /* 손상된 저장 무시 */ }
        }
      })
      .catch(() => { /* 저장소 읽기 실패 시 기본 상태로 계속 */ })
      .finally(() => {
        loadedRef.current = true;
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);
  const save = useCallback(() => {
    if (!loadedRef.current) return;
    AsyncStorage.setItem('ssal-slap', JSON.stringify(S)).catch(() => {});
  }, []);
  /* 게임 초기화 — 골드 라벨 길게 누르면 발동 */
  const resetGame = useCallback(() => {
    Alert.alert('게임 초기화', '모든 진행(골드·스탯·비품·승진)을 지우고 처음부터 시작할까?', [
      { text: '취소', style: 'cancel' },
      {
        text: '초기화', style: 'destructive',
        onPress: () => {
          Object.assign(S, JSON.parse(JSON.stringify(DEFAULT_STATE)));
          resetBagPose();
          AsyncStorage.removeItem('ssal-slap').catch(() => {});
          rerender();
        },
      },
    ]);
  }, [resetBagPose, rerender]);
  /* 인앱 결제 — 실결제. 지급은 purchaseUpdatedListener에서만 수행 (결제 성공이 확정된 시점) */
  const grantIap = useCallback(productId => {
    if (productId === 'ad_free') S.adFree = true;
    // 버프는 남은 시간에 이어붙는다 (중복 구매 시 연장)
    if (productId === 'gold_x2') S.goldBoostUntil = Math.max(Date.now(), S.goldBoostUntil) + BUFF_DURATION_MS;
    if (productId === 'one_shot') S.oneShotUntil = Math.max(Date.now(), S.oneShotUntil) + BUFF_DURATION_MS;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    save(); rerender();
  }, [save, rerender]);
  useEffect(() => {
    let purchaseSub, errorSub, cancelled = false;
    (async () => {
      try {
        await iapInitConnection();
        purchaseSub = purchaseUpdatedListener(async purchase => {
          iapBusy.current = false;
          const product = IAP_PRODUCTS.find(p => p.sku === purchase.productId);
          if (!product) return;
          grantIap(product.id);
          try {
            await finishTransaction({ purchase, isConsumable: product.consumable });
          } catch (e) { /* 미완료 트랜잭션은 다음 실행 시 리스너로 재전달됨 */ }
        });
        errorSub = purchaseErrorListener(() => { iapBusy.current = false; });
        const products = await fetchProducts({ skus: IAP_PRODUCTS.map(p => p.sku), type: 'in-app' });
        if (!cancelled) {
          const bySku = {};
          for (const p of products ?? []) bySku[p.id] = p;
          setIapProducts(bySku);
        }
        // 재설치·기기 변경 후에도 비소모성(광고 제거)은 소유 내역으로 자동 재적용
        const owned = await getAvailablePurchases();
        if (!cancelled && !S.adFree && owned?.some(p => p.productId === AD_FREE_SKU)) {
          S.adFree = true;
          save(); rerender();
        }
      } catch (e) { /* 스토어 연결 실패 — 상점 구매 버튼이 비활성 안내로 대응 */ }
    })();
    return () => {
      cancelled = true;
      purchaseSub?.remove();
      errorSub?.remove();
      iapEndConnection().catch(() => {});
    };
  }, [grantIap, save, rerender]);
  const buyIap = useCallback(async product => {
    if (iapBusy.current) return;
    if (!iapProducts[product.sku]) {
      Alert.alert('스토어 연결 안 됨', '지금은 구매할 수 없어요. 네트워크 확인 후 다시 시도해 주세요.');
      return;
    }
    iapBusy.current = true;
    try {
      await requestPurchase({
        request: { apple: { sku: product.sku }, google: { skus: [product.sku] } },
        type: 'in-app',
      });
    } catch (e) { iapBusy.current = false; /* 사용자가 결제창을 닫은 경우 포함 */ }
  }, [iapProducts]);
  /* 구매 복원 — 비소모성(광고 제거) 복원. 애플 심사 필수 요건 */
  const restoreIap = useCallback(async () => {
    try {
      await restorePurchases();
      const owned = await getAvailablePurchases();
      if (owned?.some(p => p.productId === AD_FREE_SKU)) {
        S.adFree = true;
        save(); rerender();
        Alert.alert('복원 완료', '광고 제거가 복원되었어요.');
      } else {
        Alert.alert('복원', '복원할 구매 내역이 없어요.');
      }
    } catch (e) {
      Alert.alert('복원 실패', '잠시 후 다시 시도해 주세요.');
    }
  }, [save, rerender]);
  useEffect(() => {
    const id = setInterval(save, 30000);
    const appStateSub = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') save();
    });
    return () => {
      clearInterval(id);
      appStateSub.remove();
      save();
    };
  }, [save]);

  /* 오디오 모드 — iOS 무음 스위치 상태에서도 효과음 재생 */
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  /* BGM — 수련 화면은 main, 대련(도장깨기·샌드박스)은 battle 곡 루프 */
  useEffect(() => {
    if (!loaded) return;
    playBgm(inBattle ? 'battle' : 'main', S.bgmVolume);
  }, [loaded, inBattle]);

  /* 광고 — AdMob 초기화, 전면 광고 프리로드.
   * iOS: ATT 미사용이므로 비맞춤(NPA)만 요청 (심사 2.1 ATT 이슈 대응, 2026-07-18)
   * Android: ATT 제도 없음 → 맞춤 광고 허용 (eCPM 높음) */
  useEffect(() => {
    (async () => {
      try { await mobileAds().initialize(); } catch (e) { /* 광고 실패는 게임 진행에 영향 없음 */ }
    })();
  }, []);
  useEffect(() => {
    const ad = InterstitialAd.createForAdRequest(AD_UNIT_INTERSTITIAL, { requestNonPersonalizedAdsOnly: Platform.OS === 'ios' });
    interstitialRef.current = ad;
    const subs = [
      ad.addAdEventListener(AdEventType.LOADED, () => { interstitialLoaded.current = true; }),
      // 전면 광고가 덮는 동안 BGM 정지, 닫으면 재개 + 다음 광고 프리로드
      ad.addAdEventListener(AdEventType.OPENED, () => {
        try { if (currentBgmKey) bgmPlayers[currentBgmKey]?.pause(); } catch (e) { /* noop */ }
      }),
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        interstitialLoaded.current = false;
        try { if (currentBgmKey) bgmPlayers[currentBgmKey]?.play(); } catch (e) { /* noop */ }
        ad.load();
      }),
      ad.addAdEventListener(AdEventType.ERROR, () => { interstitialLoaded.current = false; }),
    ];
    ad.load();
    return () => subs.forEach(unsub => unsub());
  }, []);
  const showInterstitial = useCallback(() => {
    if (S.adFree) return;
    if (interstitialLoaded.current) {
      try { interstitialRef.current?.show(); } catch (e) { /* noop */ }
    } else {
      interstitialRef.current?.load(); // 이전 로드 실패 시 재시도
    }
  }, []);

  /* 상점 열려 있는 동안 버프 남은 시간 1초마다 갱신 */
  useEffect(() => {
    if (!showShop) return;
    const id = setInterval(rerender, 1000);
    return () => clearInterval(id);
  }, [showShop, rerender]);

  /* 정지 그림처럼 보이지 않도록 아주 작게 호흡한다. */
  useEffect(() => {
    const playerLoop = Animated.loop(Animated.sequence([
      Animated.timing(playerIdleAnim, { toValue: 1, duration: 680, useNativeDriver: true }),
      Animated.timing(playerIdleAnim, { toValue: 0, duration: 680, useNativeDriver: true }),
    ]));
    const foeLoop = Animated.loop(Animated.sequence([
      Animated.delay(170),
      Animated.timing(foeIdleAnim, { toValue: 1, duration: 610, useNativeDriver: true }),
      Animated.timing(foeIdleAnim, { toValue: 0, duration: 610, useNativeDriver: true }),
    ]));
    playerLoop.start();
    foeLoop.start();
    return () => {
      playerLoop.stop();
      foeLoop.stop();
      clearTimeout(playerPoseTimer.current);
      clearTimeout(foePoseTimer.current);
      clearFoeCounterWork();
      clearTimeout(bagPoseTimer.current);
      clearTimeout(bagBreakTimer.current);
      clearTimeout(resultTimer.current);
      clearTimeout(attackPhaseTimer.current);
      clearTimeout(playerContactTimer.current);
      clearTimeout(playerFollowTimer.current);
      clearTimeout(playerRecoveryTimer.current);
      clearTimeout(foePhaseTimer.current);
      clearTimeout(foeContactTimer.current);
      clearTimeout(foeRecoveryTimer.current);
    };
  }, [clearFoeCounterWork]);

  /* 연출 */
  const stageSize = useRef({ w: Dimensions.get('window').width, h: 300 });
  const addFloat = useCallback((text, type, side = 'right', icon = null) => {
    const { w, h } = stageSize.current;
    const id = ++floatSeq;
    setFloats(f => [...f.slice(-14), {
      id, text, type, icon,
      x: w * (side === 'right' ? 0.52 + Math.random() * 0.26 : 0.08 + Math.random() * 0.26),
      y: h * (0.12 + Math.random() * 0.3),
    }]);
  }, []);
  const removeFloat = useCallback(id => setFloats(f => f.filter(v => v.id !== id)), []);

  /* 타격 임팩트 — 카메라 셰이크(감쇠 왕복) + 줌 펀치인, 정타는 진폭↑ + 화면 플래시 */
  const impactFx = useCallback((crit = false) => {
    const amp = crit ? 16 : 10;
    stageShake.stopAnimation();
    stageShake.setValue(0);
    Animated.sequence([
      Animated.timing(stageShake, { toValue: amp, duration: 30, useNativeDriver: true }),
      Animated.timing(stageShake, { toValue: -amp * 0.7, duration: 55, useNativeDriver: true }),
      Animated.timing(stageShake, { toValue: amp * 0.4, duration: 50, useNativeDriver: true }),
      Animated.timing(stageShake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
    stageZoom.stopAnimation();
    stageZoom.setValue(1);
    Animated.sequence([
      Animated.timing(stageZoom, { toValue: crit ? 1.08 : 1.05, duration: 50, useNativeDriver: true }),
      Animated.timing(stageZoom, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    setImpactCrit(crit);
    impactAnim.stopAnimation();
    impactAnim.setValue(0);
    Animated.sequence([
      Animated.timing(impactAnim, { toValue: 1, duration: 28, useNativeDriver: true }),
      Animated.delay(crit ? 65 : 40),
      Animated.timing(impactAnim, { toValue: 0, duration: 90, useNativeDriver: true }),
    ]).start();
    if (crit) {
      flashAnim.setValue(0.5);
      Animated.timing(flashAnim, { toValue: 0, duration: 110, useNativeDriver: true }).start();
    }
  }, []);

  const resetImpactMotion = useCallback(() => {
    stageShake.stopAnimation();
    stageZoom.stopAnimation();
    flashAnim.stopAnimation();
    impactAnim.stopAnimation();
    stageShake.setValue(0);
    stageZoom.setValue(1);
    flashAnim.setValue(0);
    impactAnim.setValue(0);
    setImpactCrit(false);
  }, []);

  const holdPlayerPose = useCallback((pose, duration) => {
    const priority = posePriority(pose);
    if (priority < playerPosePriorityRef.current) return false;
    clearTimeout(playerPoseTimer.current);
    playerPoseRef.current = pose;
    playerPosePriorityRef.current = priority;
    setPlayerPose(pose);
    const timer = setTimeout(() => {
      if (playerPoseTimer.current !== timer) return;
      playerPoseTimer.current = null;
      playerPoseRef.current = 'idle';
      playerPosePriorityRef.current = POSE_PRIORITY.idle;
      setPlayerPose('idle');
    }, duration);
    playerPoseTimer.current = timer;
    return true;
  }, []);
  const holdFoePose = useCallback((pose, duration) => {
    const priority = posePriority(pose);
    if (priority < foePosePriorityRef.current) return false;
    clearTimeout(foePoseTimer.current);
    foePoseRef.current = pose;
    foePosePriorityRef.current = priority;
    setFoePose(pose);
    const timer = setTimeout(() => {
      if (foePoseTimer.current !== timer) return;
      foePoseTimer.current = null;
      foePoseRef.current = 'idle';
      foePosePriorityRef.current = POSE_PRIORITY.idle;
      setFoePose('idle');
    }, duration);
    foePoseTimer.current = timer;
    return true;
  }, []);

  const cancelPlayerAttack = useCallback((clearQueue = true) => {
    clearTimeout(attackPhaseTimer.current);
    clearTimeout(playerContactTimer.current);
    clearTimeout(playerFollowTimer.current);
    clearTimeout(playerRecoveryTimer.current);
    attackPhaseTimer.current = null;
    playerContactTimer.current = null;
    playerFollowTimer.current = null;
    playerRecoveryTimer.current = null;
    playerAttackLocked.current = false;
    playerAttackBeforeContact.current = false;
    pendingPlayerReaction.current = null;
    if (clearQueue) pendingPlayerAttacks.current = [];
    charAnim.stopAnimation();
    charAnim.setValue(0);
  }, []);

  const resetPlayerAttackContext = useCallback(() => {
    cancelPlayerAttack();
    clearTimeout(playerPoseTimer.current);
    playerPoseTimer.current = null;
    playerPoseRef.current = 'idle';
    playerPosePriorityRef.current = POSE_PRIORITY.idle;
    setPlayerPose('idle');
  }, [cancelPlayerAttack]);

  /* 손이 실제로 닿는 한 지점에서 피격·소리·데미지를 함께 발생시킨다. */
  const playPlayerAttack = useCallback((crit = false, onContact = null) => {
    if (playerAttackLocked.current) {
      if (pendingPlayerAttacks.current.length >= PLAYER_ATTACK_QUEUE_LIMIT) return false;
      pendingPlayerAttacks.current.push({ crit, onContact });
      return true;
    }
    const side = playerAttackIndex.current % 2 ? 'Left' : 'Right';
    if (!holdPlayerPose(`windup${side}`, crit ? 380 : 315)) return false;
    playerAttackLocked.current = true;
    playerAttackBeforeContact.current = true;
    playerAttackIndex.current++;
    clearTimeout(attackPhaseTimer.current);
    clearTimeout(playerContactTimer.current);
    clearTimeout(playerFollowTimer.current);
    clearTimeout(playerRecoveryTimer.current);
    const finishAndDrain = () => {
      playerRecoveryTimer.current = null;
      playerAttackLocked.current = false;
      const next = pendingPlayerAttacks.current.shift();
      if (next) playPlayerAttackRef.current?.(next.crit, next.onContact);
    };
    attackPhaseTimer.current = setTimeout(() => {
      attackPhaseTimer.current = null;
      holdPlayerPose(`slap${side}`, crit ? 270 : 220);
    }, PLAYER_WINDUP_MS);
    playerContactTimer.current = setTimeout(() => {
      playerContactTimer.current = null;
      playerAttackBeforeContact.current = false;
      onContact?.();
      const reaction = pendingPlayerReaction.current;
      if (reaction) {
        pendingPlayerReaction.current = null;
        cancelPlayerAttack(false);
        playerReactionNowRef.current?.(reaction);
        playerRecoveryTimer.current = setTimeout(finishAndDrain, reaction.holdMs);
      } else if (pendingPlayerAttacks.current.length > 0) {
        clearTimeout(playerFollowTimer.current);
        playerFollowTimer.current = null;
        clearTimeout(playerRecoveryTimer.current);
        playerRecoveryTimer.current = setTimeout(
          finishAndDrain,
          (crit ? HIT_STOP_CRIT_MS : HIT_STOP_MS) + 35,
        );
      }
    }, PLAYER_CONTACT_MS);
    if (crit) {
      playerFollowTimer.current = setTimeout(() => {
        playerFollowTimer.current = null;
        holdPlayerPose('spin', 170);
      }, PLAYER_CONTACT_MS + PLAYER_FOLLOW_THROUGH_MS);
    }
    const totalMs = PLAYER_CONTACT_MS
      + (crit ? PLAYER_FOLLOW_THROUGH_MS + 170 : PLAYER_RECOVERY_MS);
    playerRecoveryTimer.current = setTimeout(finishAndDrain, totalMs);
    charAnim.stopAnimation();
    charAnim.setValue(0);
    Animated.sequence([
      Animated.timing(charAnim, { toValue: -1, duration: PLAYER_WINDUP_MS, useNativeDriver: true }),
      Animated.timing(charAnim, { toValue: 1, duration: PLAYER_SWING_MS, useNativeDriver: true }),
      Animated.delay(crit ? HIT_STOP_CRIT_MS : HIT_STOP_MS),
      Animated.timing(charAnim, { toValue: 0, duration: crit ? 160 : PLAYER_RECOVERY_MS, useNativeDriver: true }),
    ]).start();
    return true;
  }, [holdPlayerPose, cancelPlayerAttack]);
  playPlayerAttackRef.current = playPlayerAttack;

  const runPlayerReactionNow = useCallback(({ pose, holdMs }) => {
    if (!holdPlayerPose(pose, holdMs)) return false;
    charAnim.stopAnimation();
    charAnim.setValue(0);
    if (pose === 'hit') {
      Animated.sequence([
        Animated.timing(charAnim, { toValue: -1, duration: 75, useNativeDriver: true }),
        Animated.delay(HIT_STOP_MS),
        Animated.spring(charAnim, { toValue: 0, friction: 3, tension: 170, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(charAnim, { toValue: -1, duration: 90, useNativeDriver: true }),
        Animated.spring(charAnim, { toValue: 0, friction: 5, tension: 130, useNativeDriver: true }),
      ]).start();
    }
    return true;
  }, [holdPlayerPose]);
  playerReactionNowRef.current = runPlayerReactionNow;

  const playPlayerHit = useCallback((holdMs = 280) => {
    if (playerAttackLocked.current && playerAttackBeforeContact.current) {
      pendingPlayerReaction.current = { pose: 'hit', holdMs };
      return true;
    }
    cancelPlayerAttack();
    return runPlayerReactionNow({ pose: 'hit', holdMs });
  }, [cancelPlayerAttack, runPlayerReactionNow]);

  const playPlayerDodge = useCallback(() => {
    if (playerAttackLocked.current && playerAttackBeforeContact.current) {
      if (pendingPlayerReaction.current?.pose !== 'hit') {
        pendingPlayerReaction.current = { pose: 'dodge', holdMs: 250 };
      }
      return true;
    }
    cancelPlayerAttack();
    return runPlayerReactionNow({ pose: 'dodge', holdMs: 250 });
  }, [cancelPlayerAttack, runPlayerReactionNow]);

  const resetBagPose = useCallback(() => {
    clearTimeout(bagPoseTimer.current);
    clearTimeout(bagBreakTimer.current);
    bagPoseTimer.current = null;
    bagBreakTimer.current = null;
    lastBagHitAt.current = 0;
    // 격파 대기 중 이탈(대련 진입/장비 변경 등)하면 즉시 재정비 —
    // 늦은 타이머가 다른 티어 HP를 덮어쓰거나 0 HP로 방치되는 것 방지
    if (bagBrokenRef.current) {
      bagBrokenRef.current = false;
      if (S.bagHp <= 0) S.bagHp = BAGS[S.activeBag].hp;
    }
    setBagPose('normal');
  }, []);

  const playBagHit = useCallback(() => {
    if (bagBrokenRef.current) return false;
    const now = Date.now();
    if (now - lastBagHitAt.current < BAG_HIT_THROTTLE_MS) return false;
    lastBagHitAt.current = now;
    clearTimeout(bagPoseTimer.current);
    setBagPose('hit');
    const hitTimer = setTimeout(() => {
      if (bagPoseTimer.current !== hitTimer) return;
      setBagPose('headback');
      const reboundTimer = setTimeout(() => {
        if (bagPoseTimer.current !== reboundTimer) return;
        bagPoseTimer.current = null;
        setBagPose('normal');
      }, BAG_HEADBACK_MS);
      bagPoseTimer.current = reboundTimer;
    }, BAG_HIT_HOLD_MS);
    bagPoseTimer.current = hitTimer;
    bagAnim.stopAnimation();
    bagAnim.setValue(0);
    Animated.sequence([
      Animated.timing(bagAnim, { toValue: 12, duration: 45, useNativeDriver: true }),
      Animated.timing(bagAnim, { toValue: -4, duration: 70, useNativeDriver: true }),
      Animated.spring(bagAnim, { toValue: 0, friction: 5, tension: 150, useNativeDriver: true }),
    ]).start();
    return true;
  }, []);

  /* ── 수련: 펀치 ── */
  const punch = useCallback((auto = false) => {
    if (inBattle) return;
    if (bagBrokenRef.current) return; // 격파 연출 중 입력 잠금 (수동·자동 공통)
    if (Date.now() < stunnedUntil.current) return;
    const bag = BAGS[S.activeBag];
    let dmg = baseDamage(S) * (auto ? 0.5 : 1);
    const crit = Math.random() * 100 < critPct(S);
    if (crit) dmg *= critMul(S);
    dmg = Math.max(1, Math.round(dmg));
    if (oneShotActive(S)) dmg = Math.max(dmg, S.bagHp); // 샌드백 한 방 버프: 남은 내구도만큼 확정 데미지
    const resolvePunch = () => {
      if (bagBrokenRef.current) return;
      S.punches++;
      S.bagHp -= dmg;
      S.gold += goldFor(S, dmg);
      playBagHit();
      if (!auto || crit) impactFx(crit);
      playPunchSfx(S.punchSfx, S.sfxVolume);
      if (!auto || Math.random() < 0.3) {
        addFloat(crit ? `찰싹!! ${fmt(dmg)}` : fmt(dmg), crit ? 'crit' : 'normal');
        if (!auto) {
          Haptics.impactAsync(crit ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      }

      if (S.bagHp <= 0) {
        pendingPlayerAttacks.current = [];
        S.bagHp = 0;
        bagBrokenRef.current = true;
        clearTimeout(bagPoseTimer.current);
        bagPoseTimer.current = null;
        clearTimeout(bagBreakTimer.current);
        setBagPose('broken');
        const bonus = Math.round(Math.pow(bag.hp, 0.75) * bag.goldMul * 2 * skinBonus(S) * (goldBoostActive(S) ? 2 : 1));
        S.gold += bonus;
        impactFx(true);
        addFloat(`박살 보너스 +${fmt(bonus)}`, 'bonus', 'right', ICONS.breakBonus);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        bagBreakCount.current++;
        if (!S.adFree && bagBreakCount.current % 20 === 0) showInterstitial();
        save();
        const timer = setTimeout(() => {
          if (bagBreakTimer.current !== timer) return;
          bagBreakTimer.current = null;
          bagBrokenRef.current = false;
          S.bagHp = BAGS[S.activeBag].hp;
          setBagPose('normal');
          save();
          rerender();
        }, BAG_BREAK_MS);
        bagBreakTimer.current = timer;
      }
      rerender();
    };
    // 자동 슬랩 수치는 약속된 주기로 처리하고, 캐릭터가 비어 있을 때만 모션을 재생한다.
    if (auto && playerAttackLocked.current) {
      resolvePunch();
      return;
    }
    const attackAccepted = playPlayerAttack(crit, resolvePunch);
    if (!attackAccepted) {
      if (auto) resolvePunch();
      return;
    }
    // 경고 시작 후 350ms는 반응 유예 — 실제로 시작된 공격만 반격 판정에 포함한다.
    if (!auto && warningRef.current && Date.now() - warningStartedAt.current > 350) punchedInWarningRef.current = true;
  }, [inBattle, addFloat, playPlayerAttack, playBagHit, impactFx, rerender, save, showInterstitial]);
  const punchRef = useRef(punch);
  punchRef.current = punch;

  /* 자동 펀치 */
  const speedLv = S.lv.speed;
  useEffect(() => {
    const aps = Math.min(2, speedLv * 0.01);
    if (!aps) return;
    const id = setInterval(() => punchRef.current(true), 1000 / aps);
    return () => clearInterval(id);
  }, [speedLv]);

  /* 샌드백 반격 (수련 중) — 경고 중에 직접 클릭했을 때만 반격 */
  useEffect(() => {
    setWarning(false);
    warningRef.current = false;
    if (inBattle) return undefined;
    let t1, t2;
    const schedule = () => {
      t1 = setTimeout(() => {
        setWarning(true);
        warningRef.current = true;
        warningStartedAt.current = Date.now();
        punchedInWarningRef.current = false;
        t2 = setTimeout(() => {
          setWarning(false);
          warningRef.current = false;
          if (!punchedInWarningRef.current) { schedule(); return; }
          if (Math.random() * 100 < dodgePct(S)) {
            playPlayerDodge();
            addFloat('회피!', 'info', 'left', ICONS.dodge);
          } else {
            playPlayerHit(1500); // 스턴 시간 내내 쓰러진 포즈 유지
            stunnedUntil.current = Date.now() + 1500;
            setStunned(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            setTimeout(() => setStunned(false), 1500);
            addFloat('맞뺨 당함!', 'crit', 'left', ICONS.stun);
          }
          schedule();
        }, 900);
      }, 8000 + Math.random() * 8000);
    };
    schedule();
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [inBattle, addFloat, playPlayerDodge, playPlayerHit]);

  /* ── 대련 시작 ── */
  const startBattle = (mode, foe, meta) => {
    const pMax = playerMaxHp(S);
    resetBagPose();
    resetImpactMotion();
    clearTimeout(playerPoseTimer.current);
    clearTimeout(foePoseTimer.current);
    clearFoeCounterWork();
    clearTimeout(resultTimer.current);
    clearTimeout(attackPhaseTimer.current);
    clearTimeout(playerContactTimer.current);
    clearTimeout(playerFollowTimer.current);
    clearTimeout(playerRecoveryTimer.current);
    clearTimeout(foePhaseTimer.current);
    clearTimeout(foeContactTimer.current);
    clearTimeout(foeRecoveryTimer.current);
    playerPoseTimer.current = null;
    foePoseTimer.current = null;
    resultTimer.current = null;
    attackPhaseTimer.current = null;
    playerContactTimer.current = null;
    playerFollowTimer.current = null;
    playerRecoveryTimer.current = null;
    foePhaseTimer.current = null;
    foeContactTimer.current = null;
    foeRecoveryTimer.current = null;
    pendingPlayerAttacks.current = [];
    pendingPlayerReaction.current = null;
    pendingFoeReaction.current = null;
    playerAttackBeforeContact.current = false;
    foeAttackBeforeContact.current = false;
    playerAttackLocked.current = false;
    foeAttackLocked.current = false;
    charAnim.stopAnimation();
    bagAnim.stopAnimation();
    foeAnim.stopAnimation();
    charAnim.setValue(0);
    bagAnim.setValue(0);
    foeAnim.setValue(0);
    playerPoseRef.current = 'idle';
    foePoseRef.current = 'idle';
    playerPosePriorityRef.current = POSE_PRIORITY.idle;
    foePosePriorityRef.current = POSE_PRIORITY.idle;
    playerAttackIndex.current = 0;
    foeAttackHandIndex.current = 0;
    playerAttackLocked.current = false;
    foeAttackLocked.current = false;
    setPlayerPose('idle');
    setFoePose('idle');
    setWarning(false);
    setShowResult(false);
    setFoePickerOpen(false);
    setBattle({ mode, ...foe, maxHp: foe.hp, pHp: pMax, pMax, over: null, ...meta });
  };
  const startPvc = idx => startBattle('pvc', pvcFoe(idx), { foeIdx: idx });
  // 샌드박스 — 클리어한 상대 한정, 반격·회피·보상 없음 (순수 연타용)
  const startSandbox = idx => startBattle('sandbox', pvcFoe(idx), { foeIdx: idx });

  const battleRef = useRef(battle);
  battleRef.current = battle;

  const cancelFoeAttack = useCallback(() => {
    clearTimeout(foePhaseTimer.current);
    clearTimeout(foeContactTimer.current);
    clearTimeout(foeRecoveryTimer.current);
    foePhaseTimer.current = null;
    foeContactTimer.current = null;
    foeRecoveryTimer.current = null;
    foeAttackLocked.current = false;
    foeAttackBeforeContact.current = false;
    pendingFoeReaction.current = null;
  }, []);

  /* 상대도 2단 모션: windup 예비동작(100ms) 후 슬랩 — 예비동작이 커서 회피 타이밍이 보인다 */
  const playFoeAttack = useCallback((onContact = null) => {
    if (foeAttackLocked.current) return false;
    if (!holdFoePose('windup', 330)) return false;
    foeAttackLocked.current = true;
    foeAttackBeforeContact.current = true;
    const pose = foeAttackHandIndex.current % 2 ? 'attackRightHand' : 'attackLeftHand';
    foeAttackHandIndex.current++;
    clearTimeout(foePhaseTimer.current);
    clearTimeout(foeContactTimer.current);
    clearTimeout(foeRecoveryTimer.current);
    foePhaseTimer.current = setTimeout(() => {
      foePhaseTimer.current = null;
      holdFoePose(pose, 200);
    }, 100);
    foeContactTimer.current = setTimeout(() => {
      foeContactTimer.current = null;
      foeAttackBeforeContact.current = false;
      onContact?.();
      const reaction = pendingFoeReaction.current;
      if (reaction) {
        pendingFoeReaction.current = null;
        cancelFoeAttack();
        foeReactionNowRef.current?.(reaction);
        if (pendingFoeCounters.current > 0) {
          clearTimeout(foeCounterRetryTimer.current);
          foeCounterRetryTimer.current = setTimeout(() => {
            foeCounterRetryTimer.current = null;
            drainFoeCounterRef.current?.();
          }, reaction.holdMs);
        }
      }
    }, 155);
    foeRecoveryTimer.current = setTimeout(() => {
      foeRecoveryTimer.current = null;
      foeAttackLocked.current = false;
      if (pendingFoeCounters.current > 0) drainFoeCounterRef.current?.();
    }, 325);
    foeAnim.stopAnimation();
    foeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(foeAnim, { toValue: 1, duration: 100, useNativeDriver: true }),  // 젖히고
      Animated.timing(foeAnim, { toValue: -1, duration: 55, useNativeDriver: true }),  // 풀스윙
      Animated.delay(HIT_STOP_MS),
      Animated.timing(foeAnim, { toValue: 0, duration: 130, useNativeDriver: true }),
    ]).start();
    return true;
  }, [holdFoePose, cancelFoeAttack]);

  const runFoeReactionNow = useCallback(({ pose, holdMs }) => {
    if (!holdFoePose(pose, holdMs)) return false;
    foeAnim.stopAnimation();
    foeAnim.setValue(0);
    if (pose === 'hit') {
      Animated.sequence([
        Animated.timing(foeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.delay(HIT_STOP_MS), // 뺨 돌아간 채 멈칫
        Animated.spring(foeAnim, { toValue: 0, friction: 3, tension: 180, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(foeAnim, { toValue: 1, duration: 85, useNativeDriver: true }),
        Animated.spring(foeAnim, { toValue: 0, friction: 5, tension: 130, useNativeDriver: true }),
      ]).start();
    }
    return true;
  }, [holdFoePose]);
  foeReactionNowRef.current = runFoeReactionNow;

  const playFoeHit = useCallback(() => {
    if (foeAttackLocked.current && foeAttackBeforeContact.current) {
      pendingFoeReaction.current = { pose: 'hit', holdMs: 250 };
      return true;
    }
    cancelFoeAttack();
    return runFoeReactionNow({ pose: 'hit', holdMs: 250 });
  }, [cancelFoeAttack, runFoeReactionNow]);

  const playFoeDodge = useCallback((holdMs = 260) => {
    if (foeAttackLocked.current && foeAttackBeforeContact.current) {
      if (pendingFoeReaction.current?.pose !== 'hit') {
        pendingFoeReaction.current = { pose: 'dodge', holdMs };
      }
      return true;
    }
    cancelFoeAttack();
    return runFoeReactionNow({ pose: 'dodge', holdMs });
  }, [cancelFoeAttack, runFoeReactionNow]);

  const endBattle = useCallback((win, playerTerminalDelay = 0) => {
    const b = battleRef.current;
    if (!b || b.over) return;
    clearTimeout(playerPoseTimer.current);
    clearTimeout(foePoseTimer.current);
    clearFoeCounterWork();
    clearTimeout(resultTimer.current);
    clearTimeout(attackPhaseTimer.current);
    clearTimeout(playerContactTimer.current);
    clearTimeout(playerFollowTimer.current);
    clearTimeout(playerRecoveryTimer.current);
    clearTimeout(foePhaseTimer.current);
    clearTimeout(foeContactTimer.current);
    clearTimeout(foeRecoveryTimer.current);
    playerPoseTimer.current = null;
    foePoseTimer.current = null;
    resultTimer.current = null;
    attackPhaseTimer.current = null;
    playerContactTimer.current = null;
    playerFollowTimer.current = null;
    playerRecoveryTimer.current = null;
    foePhaseTimer.current = null;
    foeContactTimer.current = null;
    foeRecoveryTimer.current = null;
    pendingPlayerAttacks.current = [];
    pendingPlayerReaction.current = null;
    pendingFoeReaction.current = null;
    playerAttackBeforeContact.current = false;
    foeAttackBeforeContact.current = false;
    playerAttackLocked.current = false;
    foeAttackLocked.current = false;
    b.over = win ? 'win' : 'lose';
    playerPosePriorityRef.current = POSE_PRIORITY.terminal;
    foePosePriorityRef.current = POSE_PRIORITY.terminal;
    if (win) {
      if (playerTerminalDelay > 0) {
        playerPoseTimer.current = setTimeout(() => {
          playerPoseTimer.current = null;
          playerPoseRef.current = 'win';
          setPlayerPose('win');
        }, playerTerminalDelay);
      } else {
        playerPoseRef.current = 'win';
        setPlayerPose('win');
      }
      foePoseRef.current = 'ko';
      setFoePose('ko');
      let gain = b.reward;
      if (b.mode === 'sandbox') gain = 0; // 샌드박스는 보상 없음
      else if (b.mode === 'pvc' && b.foeIdx === S.pvcStage) { gain *= 3; S.pvcStage++; }
      b.gain = Math.round(gain * skinBonus(S) * (goldBoostActive(S) ? 2 : 1));
      S.gold += b.gain;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      playerPoseRef.current = 'hit';
      foePoseRef.current = 'idle';
      setPlayerPose('hit');
      setFoePose('idle');
      b.gain = 0; // 패배 시 보상 없음
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    save();
    setShowResult(false);
    setBattle({ ...b });
    resultTimer.current = setTimeout(() => setShowResult(true), 650);
  }, [save, clearFoeCounterWork]);

  const foeHitPlayer = useCallback(() => {
    const b = battleRef.current;
    if (!b || b.over) return;
    if (pendingFoeCounters.current > 0) {
      drainFoeCounterRef.current?.();
      return;
    }
    playFoeAttack(() => {
      const active = battleRef.current;
      if (!active || active.over) return;
      if (Math.random() * 100 < dodgePct(S)) {
        playPlayerDodge();
        addFloat('회피!', 'info', 'left', ICONS.dodge);
        return;
      }
      const foeCrit = Math.random() * 100 < active.crit;
      playPlayerHit();
      impactFx(foeCrit);
      playPunchSfx(S.punchSfx, S.sfxVolume);
      let dmg = active.dmg * (foeCrit ? active.critMul : 1);
      dmg = Math.max(1, Math.round(dmg));
      active.pHp -= dmg;
      addFloat(fmt(dmg), foeCrit ? 'crit' : 'normal', 'left');
      if (active.pHp <= 0) endBattle(false);
      else setBattle({ ...active });
    });
  }, [addFloat, playFoeAttack, playPlayerDodge, playPlayerHit, impactFx, endBattle]);

  // 회피 반격 — MISS가 뜨면 반드시 발동 (포즈 겹침으로 증발하지 않음).
  // 단, 플레이어 회피율만큼은 피할 수 있다.
  const drainFoeCounters = useCallback(() => {
    clearTimeout(foeCounterRetryTimer.current);
    foeCounterRetryTimer.current = null;
    if (pendingFoeCounters.current <= 0) return;
    const b = battleRef.current;
    if (!b || b.over) {
      pendingFoeCounters.current = 0;
      return;
    }
    const accepted = playFoeAttack(() => {
      const active = battleRef.current;
      if (!active || active.over) return;
      if (Math.random() * 100 < dodgePct(S)) {
        playPlayerDodge();
        addFloat('회피!', 'info', 'left', ICONS.dodge);
        return;
      }
      const foeCrit = Math.random() * 100 < active.crit;
      playPlayerHit();
      impactFx(foeCrit);
      playPunchSfx(S.punchSfx, S.sfxVolume);
      let dmg = active.dmg * (foeCrit ? active.critMul : 1);
      dmg = Math.max(1, Math.round(dmg));
      active.pHp -= dmg;
      addFloat(fmt(dmg), foeCrit ? 'crit' : 'normal', 'left');
      if (active.pHp <= 0) endBattle(false);
      else setBattle({ ...active });
    });
    if (accepted) pendingFoeCounters.current--;
    else {
      foeCounterRetryTimer.current = setTimeout(() => {
        foeCounterRetryTimer.current = null;
        drainFoeCounterRef.current?.();
      }, 80);
    }
  }, [addFloat, playFoeAttack, playPlayerDodge, playPlayerHit, impactFx, endBattle]);
  drainFoeCounterRef.current = drainFoeCounters;

  const playerHitFoe = useCallback((mult = 1) => {
    const b = battleRef.current;
    if (!b || b.over) return;
    const crit = Math.random() * 100 < critPct(S); // 정타 여부에 따라 공격 모션이 달라지므로 먼저 굴린다
    const attackAccepted = playPlayerAttack(crit, () => {
      const active = battleRef.current;
      if (!active || active.over) return;
      if (active.mode !== 'sandbox' && Math.random() * 100 < active.dodge) {
        playFoeDodge(150);
        addFloat('MISS', 'info');
        const counterTimer = setTimeout(() => {
          foeCounterTimers.current.delete(counterTimer);
          const current = battleRef.current;
          if (!current || current.over) return;
          pendingFoeCounters.current++;
          drainFoeCounterRef.current?.();
        }, 170);
        foeCounterTimers.current.add(counterTimer);
        return;
      }
      let dmg = baseDamage(S) * mult;
      if (crit) dmg *= critMul(S);
      dmg = Math.max(1, Math.round(dmg));
      addFloat(crit ? `찰싹!! ${fmt(dmg)}` : fmt(dmg), crit ? 'crit' : 'normal');
      playFoeHit();
      impactFx(crit);
      playPunchSfx(S.punchSfx, S.sfxVolume);
      if (active.mode === 'sandbox') return;
      active.hp -= dmg;
      if (active.hp <= 0) endBattle(true, LETHAL_ATTACK_HOLD_MS);
      else setBattle({ ...active });
    });
    if (!attackAccepted) return;
  }, [addFloat, playPlayerAttack, playFoeDodge, playFoeHit, impactFx, endBattle]);

  /* 대련 자동 진행 루프 — 플레이어 공격은 수동 연타 전용, 적만 자동 공격 (샌드박스는 적이 공격 안 함) */
  const battleActive = !!battle && !battle.over;
  const sandboxBattle = battle?.mode === 'sandbox';
  useEffect(() => {
    if (!battleActive || sandboxBattle) return;
    const fi = setInterval(foeHitPlayer, 700);
    return () => clearInterval(fi);
  }, [battleActive, sandboxBattle, foeHitPlayer]);

  /* 구매 */
  const buyStat = k => {
    const cost = statCost(S, k);
    if ((STATS[k].maxLv && S.lv[k] >= STATS[k].maxLv) || S.gold < cost) return;
    S.gold -= cost;
    S.lv[k]++;
    Haptics.selectionAsync().catch(() => {});
    save(); rerender();
  };
  const buyBag = idx => {
    if (idx !== S.bagLevel + 1 || idx >= BAGS.length || S.gold < BAGS[idx].cost) return;
    resetPlayerAttackContext();
    S.gold -= BAGS[idx].cost;
    S.bagLevel = idx;
    S.activeBag = idx;
    S.bagHp = BAGS[idx].hp;
    resetBagPose();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    save(); rerender();
  };
  /* 보유 중인 이전 티어 샌드백 선택 */
  const selectBag = idx => {
    if (idx > S.bagLevel || idx === S.activeBag) return;
    resetPlayerAttackContext();
    S.activeBag = idx;
    S.bagHp = BAGS[idx].hp;
    resetBagPose();
    save(); rerender();
  };
  const pickSkin = skin => {
    if (S.ownedSkins.includes(skin.id)) {
      resetPlayerAttackContext();
      S.skin = skin.id;
    } else if (S.gold >= skin.cost) {
      resetPlayerAttackContext();
      S.gold -= skin.cost;
      S.ownedSkins.push(skin.id);
      S.skin = skin.id;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else return;
    save(); rerender();
  };

  const closeBattle = () => {
    resetBagPose();
    resetImpactMotion();
    clearTimeout(playerPoseTimer.current);
    clearTimeout(foePoseTimer.current);
    clearFoeCounterWork();
    clearTimeout(resultTimer.current);
    clearTimeout(attackPhaseTimer.current);
    clearTimeout(playerContactTimer.current);
    clearTimeout(playerFollowTimer.current);
    clearTimeout(playerRecoveryTimer.current);
    clearTimeout(foePhaseTimer.current);
    clearTimeout(foeContactTimer.current);
    clearTimeout(foeRecoveryTimer.current);
    playerPoseTimer.current = null;
    foePoseTimer.current = null;
    resultTimer.current = null;
    attackPhaseTimer.current = null;
    playerContactTimer.current = null;
    playerFollowTimer.current = null;
    playerRecoveryTimer.current = null;
    foePhaseTimer.current = null;
    foeContactTimer.current = null;
    foeRecoveryTimer.current = null;
    pendingPlayerAttacks.current = [];
    pendingPlayerReaction.current = null;
    pendingFoeReaction.current = null;
    playerAttackBeforeContact.current = false;
    foeAttackBeforeContact.current = false;
    charAnim.stopAnimation();
    foeAnim.stopAnimation();
    charAnim.setValue(0);
    foeAnim.setValue(0);
    playerPoseRef.current = 'idle';
    foePoseRef.current = 'idle';
    playerPosePriorityRef.current = POSE_PRIORITY.idle;
    foePosePriorityRef.current = POSE_PRIORITY.idle;
    playerAttackIndex.current = 0;
    foeAttackHandIndex.current = 0;
    playerAttackLocked.current = false;
    foeAttackLocked.current = false;
    setPlayerPose('idle');
    setFoePose('idle');
    setShowResult(false);
    setFoePickerOpen(false);
    setBattle(null);
    // 대련·샌드박스 종료마다 전면 광고 (광고 제거 구매 시 없음)
    if (!S.adFree) showInterstitial();
  };

  if (!loaded) return <View style={st.body} />;

  const bag = BAGS[S.activeBag];

  /* ───── 대련 화면 ───── */
  if (battle) {
    return (
      <View style={st.body}>
        <StatusBar style="dark" />
        <View style={[st.hud, { paddingTop: insets.top + 6 }]}>
          <View style={st.hudTitleRow}>
            <Image source={ICONS.dojo} style={st.hudTitleIcon} resizeMode="contain" />
            <Text style={st.hudTitle}>{sandboxBattle ? '연습전' : '승진 슬랩'}</Text>
          </View>
          {sandboxBattle && battleActive && (
            <Pressable style={st.foePickerBtn} onPress={() => setFoePickerOpen(v => !v)}>
              <Text style={st.foePickerText}>{battle.name} {foePickerOpen ? '▲' : '▼'}</Text>
            </Pressable>
          )}
          {battleActive && (
            <Pressable style={st.giveUpBtn} onPress={() => sandboxBattle ? closeBattle() : endBattle(false)}>
              <Text style={st.giveUpText}>{sandboxBattle ? '그만두기' : '기권'}</Text>
            </Pressable>
          )}
        </View>
        {sandboxBattle && foePickerOpen && (
          <View style={[st.foePickerList, { top: insets.top + 58 }]}>
            <ScrollView>
              {Array.from({ length: S.pvcStage }, (_, i) => i).map(i => {
                const f = pvcFoe(i);
                return (
                  <Pressable key={i} style={[st.foePickerItem, battle.foeIdx === i && st.rowEquipped]}
                    onPress={() => { setFoePickerOpen(false); if (battle.foeIdx !== i) startSandbox(i); }}>
                    <Image source={f.img} style={st.foePickerImg} resizeMode="contain" />
                    <Text style={st.foePickerItemText}>{f.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
        <AnimatedPressable
          style={[st.stage, { transform: [{ translateX: stageShake }, { scale: stageZoom }] }]}
          onLayout={e => { stageSize.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
          onPressIn={() => battleActive && playerHitFoe(0.6)}>
          <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            <Image source={battle.background} style={{ width: '100%', height: '100%' }} resizeMode="cover" fadeDuration={0} />
          </View>

          <View style={[
            st.fighter,
            (playerPose === 'slapLeft' || playerPose === 'slapRight') && st.playerSlapFront,
          ]}>
            {!sandboxBattle && <View style={st.hpTrack}><View style={[st.hpFill, { width: `${Math.max(0, battle.pHp / battle.pMax * 100)}%`, backgroundColor: C.accent }]} /></View>}
            <Animated.Image source={playerPoseSource(S.skin, playerPose)} fadeDuration={0} resizeMode="contain"
              style={[st.fighterImg, {
                opacity: battle.over === 'lose' ? 0.58 : 1,
                transform: [
                  { translateY: !battle.over && playerPose === 'idle' ? playerIdleAnim.interpolate({ inputRange: [0, 1], outputRange: [2, -5] }) : 0 },
                  { translateY: battle.over === 'lose' ? 14 : 0 },
                  { translateX: charAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-10, 0, 18] }) },
                  { rotate: charAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-7deg', '0deg', '9deg'] }) },
                  { rotate: battle.over === 'lose' ? '-10deg' : '0deg' },
                ],
              }]} />
            <Text style={st.fighterName}>쌀알이</Text>
          </View>

          <View style={[
            st.fighter,
            (foePose === 'attackLeftHand' || foePose === 'attackRightHand') && st.foeSlapFront,
          ]}>
            {!sandboxBattle && <View style={st.hpTrack}><View style={[st.hpFill, { width: `${Math.max(0, battle.hp / battle.maxHp * 100)}%`, backgroundColor: C.danger }]} /></View>}
            <Animated.Image source={battle.poses?.[foePose] ?? battle.img} fadeDuration={0} resizeMode="contain"
              style={[st.fighterImg, battle.id === 'ricebag_king' && st.colossalFoeImg, {
                opacity: battle.over === 'win' ? 0.58 : 1,
                transform: [
                  { translateX: battle.id === 'ricebag_king' ? -20 : 0 },
                  { translateY: battle.id === 'ricebag_king' ? -14 : 0 },
                  { translateY: !battle.over && foePose === 'idle' ? foeIdleAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) : 0 },
                  { translateY: battle.over === 'win' ? 14 : 0 },
                  { translateX: foeAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-18, 0, 12] }) },
                  { rotate: foeAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-8deg', '0deg', '7deg'] }) },
                  { rotate: battle.over === 'win' ? '10deg' : '0deg' },
                ],
              }]} />
            <Text style={st.fighterName}>{battle.name}</Text>
          </View>

          <Animated.Image
            pointerEvents="none"
            source={impactCrit ? EFFECTS.impactCrit : EFFECTS.impact}
            style={[st.impactBurst, st.battleImpact, {
              opacity: impactAnim,
              transform: [
                { scale: impactAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1.35] }) },
                { rotate: impactAnim.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '8deg'] }) },
              ],
            }]}
          />
          {floats.map(f => <FloatingText key={f.id} item={f} onDone={removeFloat} />)}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: '#fff', opacity: flashAnim, zIndex: 40 }]} />

          {battle.over && showResult && (
            <View style={st.resultOverlay}>
              <Image source={battle.over === 'win' ? ICONS.victory : ICONS.defeat} style={st.resultIcon} resizeMode="contain" />
              <Text style={st.resultTitle}>{battle.over === 'win' ? '승리!' : '패배...'}</Text>
              {battle.gain > 0 && (
                <GoldLabel style={st.resultGoldRow} textStyle={st.resultGold} iconSize={24}>+{fmt(battle.gain)}</GoldLabel>
              )}
              <Pressable style={st.resultBtn} onPress={closeBattle}>
                <Text style={st.resultBtnText}>확인</Text>
              </Pressable>
            </View>
          )}
        </AnimatedPressable>
        <View style={[st.battleHint, { paddingBottom: insets.bottom + 10 }]}>
          <Text style={st.hintText}>
            {sandboxBattle ? '반격 없음! 마음껏 때리자! (보상 없음)' : '승진 슬랩은 자동 슬랩 없음! 직접 연타로 승부해!'}
          </Text>
        </View>
      </View>
    );
  }

  /* ───── 메인 화면 ───── */
  return (
    <View style={st.body}>
      <StatusBar style="dark" />

      <View style={[st.hud, { paddingTop: insets.top + 6 }]}>
        <GoldLabel textStyle={st.gold} iconSize={28}>{fmt(S.gold)}</GoldLabel>
        <View>
          <Text style={st.hudSub}>{bag.name} · 골드 ×{bag.goldMul}</Text>
          <Text style={st.hudSub2}>전투력 {fmt(powerScore(S))} · 직급 {PLAYER_RANKS[Math.min(S.pvcStage, PLAYER_RANKS.length - 1)]}</Text>
        </View>
      </View>

      {showSettings && (
        <View style={st.settingsOverlay}>
          <View style={st.settingsPanel}>
            <Text style={st.settingsTitle}>설정</Text>
            <Text style={st.soundSection}>슬랩 효과음</Text>
            <View style={st.sfxPickRow}>
              {PUNCH_SFX_OPTIONS.map(o => (
                <Pressable key={o.id} style={[st.sfxPickBtn, S.punchSfx === o.id && st.sfxPickBtnOn]}
                  onPress={() => { S.punchSfx = o.id; save(); rerender(); playPunchSfx(o.id, S.sfxVolume); }}>
                  <Text style={[st.sfxPickText, S.punchSfx === o.id && st.sfxPickTextOn]}>{o.name}</Text>
                </Pressable>
              ))}
            </View>
            <View style={st.volRow}>
              <Text style={st.volLabel}>효과음 볼륨</Text>
              <Slider style={st.volSlider} minimumValue={0} maximumValue={1} value={S.sfxVolume}
                minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent}
                onValueChange={v => { S.sfxVolume = v; }}
                onSlidingComplete={v => { S.sfxVolume = v; save(); rerender(); playPunchSfx(S.punchSfx, v); }} />
            </View>
            <View style={st.volRow}>
              <Text style={st.volLabel}>배경음 볼륨</Text>
              <Slider style={st.volSlider} minimumValue={0} maximumValue={1} value={S.bgmVolume}
                minimumTrackTintColor={C.accent} maximumTrackTintColor={C.line} thumbTintColor={C.accent}
                onValueChange={v => { S.bgmVolume = v; setBgmVolume(v); }}
                onSlidingComplete={v => { S.bgmVolume = v; setBgmVolume(v); save(); rerender(); }} />
            </View>
            <Pressable style={st.settingsDangerBtn} onPress={resetGame}>
              <Text style={st.settingsDangerText}>게임 초기화</Text>
            </Pressable>
            <Pressable style={[st.resultBtn, st.settingsCloseBtn]} onPress={() => setShowSettings(false)}>
              <Text style={st.resultBtnText}>닫기</Text>
            </Pressable>
          </View>
        </View>
      )}

      {showShop && (
        <View style={st.settingsOverlay}>
          <View style={st.settingsPanel}>
            <Text style={st.settingsTitle}>🎁 상점</Text>
            {IAP_PRODUCTS.map(p => {
              const owned = p.id === 'ad_free' && S.adFree;
              const until = p.id === 'gold_x2' ? S.goldBoostUntil : p.id === 'one_shot' ? S.oneShotUntil : 0;
              const active = until > Date.now();
              const storeProduct = iapProducts[p.sku];
              const priceLabel = storeProduct?.displayPrice ?? p.price;
              return (
                <View key={p.id} style={st.shopRow}>
                  <Text style={st.shopIcon}>{p.icon}</Text>
                  <View style={st.rowBody}>
                    <Text style={st.rowName}>{p.name}</Text>
                    <Text style={[st.rowDesc, (owned || active) && st.shopActiveDesc]}>
                      {owned ? '적용 중 (영구)' : active ? `적용 중 · ${fmtRemain(until - Date.now())} 남음` : p.desc}
                    </Text>
                  </View>
                  {owned
                    ? <Text style={st.rowCost}>구매 완료</Text>
                    : (
                      <Pressable style={[st.shopBuyBtn, !storeProduct && st.rowOff]} onPress={() => buyIap(p)}>
                        <Text style={st.shopBuyText}>{active ? `연장 ${priceLabel}` : priceLabel}</Text>
                      </Pressable>
                    )}
                </View>
              );
            })}
            <Pressable style={st.restoreBtn} onPress={restoreIap}>
              <Text style={st.restoreText}>구매 복원</Text>
            </Pressable>
            <Pressable style={[st.resultBtn, st.settingsCloseBtn]} onPress={() => setShowShop(false)}>
              <Text style={st.resultBtnText}>닫기</Text>
            </Pressable>
          </View>
        </View>
      )}

      <AnimatedPressable
        style={[st.stage, st.trainStage, { transform: [{ translateX: stageShake }, { scale: stageZoom }] }]}
        onLayout={e => { stageSize.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
        onPressIn={() => punch(false)}>
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Image source={bag.background} style={{ width: '100%', height: '100%' }} resizeMode="cover" fadeDuration={0} />
        </View>
        <Pressable onPress={() => setShowSettings(true)} style={st.stageSettingsBtn} hitSlop={10}>
          <SettingsIcon size={26} color={C.ink} />
        </Pressable>
        <Pressable onPress={() => setShowShop(true)} style={st.stageGiftBtn} hitSlop={10}>
          <Text style={st.giftEmoji}>🎁</Text>
        </Pressable>
        <Animated.Image
          source={playerPoseSource(S.skin, playerPose)}
          fadeDuration={0}
          resizeMode="contain"
          style={[st.char, {
            opacity: stunned ? 0.5 : 1,
            transform: [
              { translateY: playerPose === 'idle' ? playerIdleAnim.interpolate({ inputRange: [0, 1], outputRange: [2, -5] }) : 0 },
              { translateX: charAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [-10, 0, 18] }) },
              { rotate: charAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-7deg', '0deg', '9deg'] }) },
            ],
          }]} />
        {stunned && <Image source={ICONS.stun} style={st.stunStars} resizeMode="contain" />}

        <Animated.View style={{
          transform: [
            { translateY: -190 },
            { rotate: bagAnim.interpolate({ inputRange: [-30, 30], outputRange: ['-30deg', '30deg'] }) },
            { translateY: 190 },
          ],
          alignItems: 'center',
        }}>
          {warning && <Text style={st.warning}>맞뺨 주의!</Text>}
          <View style={[st.hpTrack, st.bagHpTop]}>
            <View style={[st.hpFill, { width: `${Math.max(0, S.bagHp / bag.hp * 100)}%`, backgroundColor: C.ink }]} />
          </View>
          <Image source={bag.poses[bagPose] ?? bag.poses.normal} fadeDuration={0}
            style={[st.bagImg, bagPose === 'broken' && st.bagBroken]} resizeMode="contain" />
        </Animated.View>

        <Animated.Image
          pointerEvents="none"
          source={impactCrit ? EFFECTS.impactCrit : EFFECTS.impact}
          style={[st.impactBurst, st.trainImpact, {
            opacity: impactAnim,
            transform: [
              { scale: impactAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1.35] }) },
              { rotate: impactAnim.interpolate({ inputRange: [0, 1], outputRange: ['-12deg', '8deg'] }) },
            ],
          }]}
        />
        {floats.map(f => <FloatingText key={f.id} item={f} onDone={removeFloat} />)}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: '#fff', opacity: flashAnim, zIndex: 40 }]} />
      </AnimatedPressable>

      <View style={[st.panel, { paddingBottom: insets.bottom + 8 }]}>
        <View style={st.tabs}>
          {[['stats', '업무'], ['gear', '비품'], ['battle', '승진'], ['skins', '옷장']].map(([key, label]) => (
            <Pressable key={key} onPress={() => setTab(key)} style={[st.tab, tab === key && st.tabOn]}>
              <Text style={[st.tabText, tab === key && st.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={st.list}>
          {tab === 'stats' && STAT_KEYS.map(k => {
            const maxed = STATS[k].maxLv && S.lv[k] >= STATS[k].maxLv;
            const cost = statCost(S, k);
            return (
              <Pressable key={k} onPress={() => buyStat(k)} style={[st.row, (maxed || S.gold < cost) && st.rowOff]}>
                <Image source={STATS[k].icon} style={st.rowIconImg} resizeMode="contain" />
                <View style={st.rowBody}>
                  <Text style={st.rowName}>{STATS[k].name} Lv.{S.lv[k]}</Text>
                  <Text style={st.rowDesc}>{statDesc[k](S)}</Text>
                </View>
                {maxed
                  ? <Text style={st.rowCost}>MAX</Text>
                  : <GoldLabel textStyle={st.rowCost}>{fmt(cost)}</GoldLabel>}
              </Pressable>
            );
          })}

          {tab === 'gear' && BAGS.map((b, i) => {
            const state = i <= S.bagLevel ? 'owned' : i === S.bagLevel + 1 ? 'next' : 'locked';
            return (
              <Pressable key={b.name}
                onPress={() => state === 'next' ? buyBag(i) : state === 'owned' ? selectBag(i) : null}
                style={[st.row, state === 'locked' && st.rowOff, i === S.activeBag && st.rowEquipped]}>
                <Image source={b.poses.normal} style={st.rowImg} resizeMode="contain" />
                <View style={st.rowBody}>
                  <Text style={st.rowName}>{b.name}</Text>
                  <Text style={st.rowDesc}>내구도 {fmt(b.hp)} · 골드 ×{b.goldMul}</Text>
                </View>
                {i === S.activeBag
                  ? <Text style={st.rowCost}>사용 중</Text>
                  : state === 'owned'
                    ? <Text style={st.rowCost}>선택</Text>
                    : state === 'next'
                      ? <GoldLabel textStyle={st.rowCost}>{fmt(b.cost)}</GoldLabel>
                      : <Image source={ICONS.lock} style={st.statusIcon} resizeMode="contain" />}
              </Pressable>
            );
          })}

          {tab === 'battle' && (
            <>
              <View style={st.sectionTitleRow}>
                <Image source={ICONS.stun} style={st.sectionTitleIcon} resizeMode="contain" />
                <Text style={st.sectionTitle}>연습전</Text>
              </View>
              {S.pvcStage === 0 ? (
                <View style={[st.row, st.rowOff]}>
                  <Image source={ICONS.lock} style={st.rowIconImg} resizeMode="contain" />
                  <View style={st.rowBody}>
                    <Text style={st.rowName}>아직 잠겨 있어</Text>
                    <Text style={st.rowDesc}>승진 슬랩 1관을 이기면 열려!</Text>
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => startSandbox(S.pvcStage - 1)} style={st.row}>
                  <Image source={pvcFoe(S.pvcStage - 1).img} style={st.rowImg} resizeMode="contain" />
                  <View style={st.rowBody}>
                    <Text style={st.rowName}>무한 연습전</Text>
                    <Text style={st.rowDesc}>이겨본 상사와 자유 대련! 상대 교체는 안에서 · 보상 없음</Text>
                  </View>
                  <Text style={st.rowCost}>입장</Text>
                </Pressable>
              )}
              <View style={st.sectionTitleRow}>
                <Image source={ICONS.dojo} style={st.sectionTitleIcon} resizeMode="contain" />
                <Text style={st.sectionTitle}>승진 슬랩 — 직급 사다리</Text>
              </View>
              {Array.from({ length: Math.min(PVC_STAGES, Math.max(FOES.length, S.pvcStage + 2)) }, (_, i) => i).map(i => {
                const f = pvcFoe(i);
                const locked = i > S.pvcStage;
                const cleared = i < S.pvcStage;
                return (
                  <Pressable key={i} onPress={() => !locked && startPvc(i)} style={[st.row, locked && st.rowOff]}>
                    <Image source={f.img} style={st.rowImg} resizeMode="contain" />
                    <View style={st.rowBody}>
                      <View style={st.rowNameLine}>
                        <Text style={st.rowName}>{i + 1}관 · {f.name}</Text>
                        {cleared && <Image source={ICONS.clear} style={st.clearIcon} resizeMode="contain" />}
                      </View>
                      <View style={st.inlineMeta}>
                        <Text style={st.rowDesc}>체력 {fmt(f.hp)} · 보상</Text>
                        <GoldLabel textStyle={st.rowDesc} iconSize={14}>{fmt(f.reward)}</GoldLabel>
                        {!cleared && !locked && <Text style={st.rowDesc}>(첫 승진 ×3)</Text>}
                      </View>
                    </View>
                    {locked
                      ? <Image source={ICONS.lock} style={st.statusIcon} resizeMode="contain" />
                      : <Text style={st.rowCost}>도전</Text>}
                  </Pressable>
                );
              })}
            </>
          )}

          {tab === 'skins' && SKINS.map(skin => {
            const owned = S.ownedSkins.includes(skin.id);
            const equipped = S.skin === skin.id;
            return (
              <Pressable key={skin.id} onPress={() => pickSkin(skin)}
                style={[st.row, !owned && S.gold < skin.cost && st.rowOff, equipped && st.rowEquipped]}>
                <Image source={SKIN_IMG[skin.id]} style={st.rowImg} resizeMode="contain" />
                <View style={st.rowBody}>
                  <Text style={st.rowName}>{skin.name}</Text>
                  <Text style={st.rowDesc}>{skin.desc} · 골드 +{Math.round(skin.bonus * 100)}%</Text>
                </View>
                {owned
                  ? <Text style={st.rowCost}>{equipped ? '착용 중' : '보유'}</Text>
                  : <GoldLabel textStyle={st.rowCost}>{fmt(skin.cost)}</GoldLabel>}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

/* ───────── 스타일 ───────── */
const st = StyleSheet.create({
  body: { flex: 1, backgroundColor: C.bg },
  hud: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 18, paddingBottom: 12,
    backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  gold: { fontSize: 22, fontWeight: '800', color: C.ink },
  hudTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hudTitleIcon: { width: 24, height: 24 },
  hudTitle: { fontSize: 18, fontWeight: '800', color: C.ink },
  hudSub: { fontSize: 13, fontWeight: '600', color: C.ink, textAlign: 'right' },
  hudSub2: { fontSize: 11, color: C.sub, textAlign: 'right' },

  stage: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 18, backgroundColor: C.panel,
    position: 'relative', overflow: 'hidden',
  },
  // 쌀알이/샌드백 PNG의 투명 여백을 실측(alpha bbox)해서 보이는 몸끼리 붙도록 겹침·높이 보정
  // (240px 샌드백 기준: 쌀알이 우측 투명 ~29px + 샌드백 좌측 투명 ~75px → -100이면 실제 틈 ~4px)
  char: { width: 150, height: 150, marginRight: -100, marginBottom: 6, zIndex: 10, elevation: 10 },
  // 수련 화면: 쌀알이·샌드백을 중앙에 붙여 바닥 높이를 맞춤 (기본 stage는 대련 화면과 공유)
  trainStage: { alignItems: 'flex-end', paddingBottom: 40, gap: 0 },
  bagHpTop: { marginTop: 0, marginBottom: 4 }, // 표적 에셋 머리와 겹치지 않게 살짝 띄움
  bagBroken: { opacity: 0.55 }, // 격파 프레임은 반투명
  bagImg: { width: 240, height: 240 }, // 512² 정사각 PNG, 20% 축소판
  stunStars: { position: 'absolute', width: 34, height: 34, top: '26%', left: '16%', zIndex: 10 },
  warning: { fontSize: 20, fontWeight: '900', color: C.danger, marginBottom: 4 },

  hpTrack: { width: 96, height: 8, borderRadius: 4, backgroundColor: C.line, marginTop: 8, overflow: 'hidden', zIndex: 20 },
  hpFill: { height: '100%', borderRadius: 4 },

  fighter: { alignItems: 'center', width: '42%' },
  playerSlapFront: { zIndex: 13, elevation: 13 },
  foeSlapFront: { zIndex: 12, elevation: 12 },
  fighterImg: { width: 130, height: 130 },
  colossalFoeImg: { width: 340, height: 340, marginVertical: -105 },
  fighterName: {
    marginTop: 6, fontSize: 13, fontWeight: '700', color: '#FFFFFF',
    zIndex: 20,
    textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  impactBurst: {
    position: 'absolute', width: 92, height: 92, zIndex: 35, elevation: 35,
  },
  battleImpact: { left: '44%', top: '34%' },
  trainImpact: { left: '53%', top: '31%' },

  resultOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center', zIndex: 50,
  },
  resultIcon: { width: 68, height: 68, marginBottom: 6 },
  resultTitle: { fontSize: 34, fontWeight: '900', color: C.ink },
  resultGoldRow: { marginTop: 8 },
  resultGold: { fontSize: 22, fontWeight: '800', color: '#C99700' },
  resultSub: { fontSize: 14, color: C.sub, marginTop: 4 },
  resultBtn: {
    marginTop: 18, backgroundColor: C.ink, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 44,
  },
  resultBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  battleHint: { padding: 14, alignItems: 'center', backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line, gap: 10 },
  hintText: { fontSize: 12, color: C.sub },
  giveUpBtn: {
    borderWidth: 1.5, borderColor: C.danger, borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 28,
  },
  /* 샌드박스 상대 교체 드롭박스 */
  foePickerBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.line, borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 14, backgroundColor: C.panel,
    flexShrink: 1, marginHorizontal: 8,
  },
  foePickerText: { fontSize: 13, fontWeight: '700', color: C.ink },
  foePickerList: {
    position: 'absolute', alignSelf: 'center', width: 250, maxHeight: 320,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 12,
    zIndex: 50, elevation: 50, overflow: 'hidden',
  },
  foePickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  foePickerImg: { width: 32, height: 32 },
  foePickerItemText: { fontSize: 14, fontWeight: '600', color: C.ink, flexShrink: 1 },
  giveUpText: { fontSize: 13, fontWeight: '700', color: C.danger },

  /* 설정 */
  stageSettingsBtn: { position: 'absolute', top: 12, right: 14, zIndex: 20, padding: 4 },
  settingsCloseBtn: { alignItems: 'center', marginTop: 8 },
  settingsOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  settingsPanel: {
    width: '84%', maxHeight: '80%', backgroundColor: C.bg, borderRadius: 16,
    borderWidth: 1.5, borderColor: C.ink, padding: 18, alignItems: 'stretch', gap: 10,
  },
  settingsTitle: { fontSize: 18, fontWeight: '900', color: C.ink, textAlign: 'center', marginBottom: 4 },
  /* 사운드 설정 */
  soundSection: { fontSize: 13, fontWeight: '800', color: C.sub, marginTop: 6 },
  sfxPickRow: { flexDirection: 'row', gap: 8 },
  sfxPickBtn: {
    flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 10,
    paddingVertical: 9, alignItems: 'center',
  },
  sfxPickBtnOn: { borderColor: C.accent, backgroundColor: C.panel },
  sfxPickText: { fontSize: 14, fontWeight: '700', color: C.sub },
  sfxPickTextOn: { color: C.ink },
  volRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  volLabel: { fontSize: 13, fontWeight: '600', color: C.ink, width: 78 },
  volSlider: { flex: 1, height: 34 },
  settingsDangerBtn: {
    borderWidth: 1.5, borderColor: C.danger, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
  },
  settingsDangerText: { fontSize: 14, fontWeight: '700', color: C.danger },

  /* 상점 + 광고 */
  stageGiftBtn: { position: 'absolute', top: 52, right: 14, zIndex: 20, padding: 4 },
  giftEmoji: { fontSize: 24 },
  shopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  shopIcon: { fontSize: 26 },
  shopActiveDesc: { color: C.accent, fontWeight: '700' },
  shopBuyBtn: { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  shopBuyText: { fontSize: 13, fontWeight: '800', color: C.bg },
  restoreBtn: { alignItems: 'center', paddingVertical: 8 },
  restoreText: { fontSize: 13, fontWeight: '700', color: C.sub, textDecorationLine: 'underline' },

  panel: { backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 12, paddingTop: 8 },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: C.panel, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  tabOn: { backgroundColor: C.ink, borderColor: C.ink },
  tabText: { fontSize: 14, fontWeight: '700', color: C.sub },
  tabTextOn: { color: '#fff' },
  list: { maxHeight: 250 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginVertical: 6, marginLeft: 2 },
  sectionTitleIcon: { width: 19, height: 19 },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: C.sub },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.bg, borderRadius: 12, padding: 10, marginBottom: 6,
    borderWidth: 1, borderColor: C.line,
  },
  rowOff: { opacity: 0.4 },
  rowEquipped: { borderWidth: 2, borderColor: C.accent },
  rowIconImg: { width: 34, height: 34 },
  rowImg: { width: 38, height: 38 },
  rowBody: { flex: 1 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  inlineMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  clearIcon: { width: 16, height: 16 },
  statusIcon: { width: 22, height: 22 },
  rowName: { fontSize: 14, fontWeight: '800', color: C.ink },
  rowDesc: { fontSize: 12, color: C.sub },
  rowCost: { fontSize: 14, fontWeight: '800', color: C.ink },
});
