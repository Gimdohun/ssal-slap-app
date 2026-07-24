# 안드로이드 광고·IAP 적용 가이드 (v1.1.0)

2026-07-18 기준. iOS 출시 작업(v1.1.0)에서 실결제 IAP(expo-iap)·AdMob 전면광고·세이프에어리어가
크로스플랫폼 코드로 들어갔다. **안드로이드는 코드 수정 없이 아래 절차만 밟으면 같은 기능이 적용된다.**

## 1. 발급된 AdMob ID (2026-07-18, 계정: ksm30546@gmail.com — Play Console과 동일 계정)

| 플랫폼 | 앱 ID | 전면 광고 단위(interstitial-main) |
|---|---|---|
| Android | `ca-app-pub-1447190695017955~5885348071` | `ca-app-pub-1447190695017955/8275139479` |
| iOS | `ca-app-pub-1447190695017955~4580125408` | `ca-app-pub-1447190695017955/7453700756` |

- 이미 코드에 반영돼 있다: `app.json` 플러그인 설정(앱 ID) + `App.js`의 `AD_UNIT_INTERSTITIAL`(단위 ID).
- `__DEV__`(개발 빌드)에서는 자동으로 구글 테스트 광고가 나온다. 릴리즈 빌드만 실광고.
- 새 광고 단위는 트래픽이 실리기까지 최대 1시간 걸릴 수 있음.

## 2. 안드로이드 네이티브 재생성 (필수!)

커밋된 `android/` 폴더는 **v1.0 시절 prebuild 산출물**이라 새 네이티브 모듈
(react-native-google-mobile-ads, expo-iap, react-native-safe-area-context)의 매니페스트 설정이 없다.
특히 AdMob은 AndroidManifest.xml에 앱 ID meta-data가 없으면 **실행 즉시 크래시**한다.

```bash
npm install
npx expo prebuild -p android --clean   # android/ 재생성 (매니페스트에 AdMob 앱 ID 주입됨)
```

재생성 후 확인:
```bash
grep -A1 "com.google.android.gms.ads.APPLICATION_ID" android/app/src/main/AndroidManifest.xml
# → ca-app-pub-1447190695017955~5885348071 나와야 정상
```

주의: `--clean`은 android/를 갈아엎으므로, 서명 키(`android/app/upload-key.keystore`)는
gitignore돼 로컬에만 있다 → **미리 백업해두고 prebuild 후 다시 넣을 것.**
`android/app/build.gradle`의 signingConfig 수동 설정도 다시 적용해야 한다 (기존 커밋 diff 참고).

## 3. Google Play 인앱 상품 등록

코드가 기대하는 상품 ID (Play Console → 수익 창출 → 인앱 상품):

| 상품 ID | 유형 | 이름(예시) | 가격 |
|---|---|---|---|
| `app.ssalfighter.mobile.ad_free` | 비소모성 | 광고 제거 | ₩9,900 |
| `app.ssalfighter.mobile.gold_x2` | 소모성(consumable) | 골드 2배 (2시간) | ₩3,900 |
| `app.ssalfighter.mobile.one_shot` | 소모성(consumable) | 샌드백 한 방 (2시간) | ₩6,900 |

- Play는 "소모성" 구분이 없고 앱이 consume 처리함 — expo-iap `finishTransaction({isConsumable:true})`가 이미 처리.
- 상품 등록에는 **결제 프로필 연결된 개발자 계정** 필요.
- 인앱 상품이 활성화되려면 해당 버전 AAB가 (내부 테스트 트랙이라도) 업로드돼 있어야 한다.

## 4. AdMob 잔여 작업 (콘솔, 사람 손 필요)

1. **결제 프로필 작성** — AdMob 홈 상단 빨간 배너 "결제 설정 미완료" → 지급 세부정보(은행) 입력.
   미입력 시 앱 검토가 보류돼 실광고가 안 나온다.
2. **앱 스토어 연결** — Play 출시 후: AdMob → 앱 → 격투왕 쌀알이 키우기(Android) → 앱 설정 →
   "앱 스토어에 연결"로 Play 등록 정보 연결 (검토 승인에 필요). iOS도 App Store 출시 후 동일.
3. **app-ads.txt** (권장) — 개발자 웹사이트 루트에 아래 한 줄 파일 `/app-ads.txt` 게시:
   `google.com, pub-1447190695017955, DIRECT, f08c47fec0942fa0`

## 5. Play 정책 체크리스트 (광고 추가로 새로 생기는 것)

- Play Console → 앱 콘텐츠 → **광고**: "예, 앱에 광고 포함" 로 변경
- **데이터 보안** 폼: 광고 SDK가 광고 ID(AAID)·대략적 위치·앱 상호작용을 수집한다고 신고
- 대상 연령에 어린이 포함 시 광고 정책이 훨씬 엄격해짐 — 현재 설정 확인 필요

## 6. 릴리즈 빌드

```bash
cd android && ./gradlew bundleRelease   # AAB: android/app/build/outputs/bundle/release/
```
app.json 기준 versionCode 3 / versionName 1.1.0 (prebuild가 반영). 업로드 전 서명 설정 원복 필수.
