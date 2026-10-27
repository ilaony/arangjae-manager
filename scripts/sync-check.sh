#!/bin/zsh
# 아랑재 메일 동기화 — 탐지 전용 배치 실행
#
#   scripts/sync-check.sh          최근 7일
#   scripts/sync-check.sh 14       최근 14일
#
# 대조 보고까지만 하고 Firestore에는 쓰지 않는다. 배치에는 승인할 사람이
# 없기 때문이다. 차이가 나오면 알림이 뜨므로, 반영은 Claude Code를 열고
# "반영해줘" 하면 된다.
#
# 전제: Aside 앱이 실행 중이어야 한다 (Gmail을 브라우저 세션으로 읽는다).

set -u

REPO="/Users/laony/EMTech/arangjae"
DAYS="${1:-7}"
LOGDIR="$HOME/Library/Logs/arangjae"
OUT="$LOGDIR/sync-$(date +%Y%m%d-%H%M).md"

mkdir -p "$LOGDIR"
cd "$REPO" || { echo "저장소를 찾을 수 없다: $REPO"; exit 1; }

claude -p "/아랑재동기화 ${DAYS}

추가 지시: 이 실행은 배치라서 승인할 사람이 없다. **Firestore에 아무것도 쓰지 말고** 대조 보고까지만 하라.
맨 마지막 줄에 반드시 이 형식 한 줄을 출력하라 — 차이가 없으면 \`RESULT: CLEAN\`, 있으면 \`RESULT: DIFF <건수>건\`." \
  --settings "$REPO/.claude/batch-readonly.json" \
  < /dev/null > "$OUT" 2>&1
RC=$?

RESULT=$(grep '^RESULT:' "$OUT" | tail -1)

if [ $RC -ne 0 ]; then
  MSG="실행 실패 (종료코드 ${RC})"
elif [ -z "$RESULT" ]; then
  MSG="결과 줄을 못 찾음 — 로그를 확인하세요"
else
  MSG="$RESULT"
fi

echo "$MSG"
echo "로그: $OUT"

# 이상 없으면 조용히 끝낸다. 알림은 볼 게 있을 때만.
if [ "$MSG" != "RESULT: CLEAN" ]; then
  osascript -e "display notification \"${MSG}\" with title \"아랑재 동기화\"" >/dev/null 2>&1
fi
