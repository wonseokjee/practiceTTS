#!/usr/bin/env bash
# 병합이 끝난 git 워크트리와 그 로컬 브랜치를 정리한다 (Orca 왼쪽 목록 정리용).
#
#   bash scripts/prune-merged-worktrees.sh          # 미리보기만 (아무것도 안 지움)
#   bash scripts/prune-merged-worktrees.sh --apply  # 실제로 정리
#
# 지우는 조건 (하나라도 해당해야 함):
#   - 브랜치: PR이 MERGED이고, 병합 커밋이 origin/main에 도달했고, 로컬 HEAD가 PR 헤드와 같음
#             ("MERGED 표시"만으로는 안 믿는다. PR 뒤에 커밋을 더 쌓은 브랜치는 남긴다)
#   - detached: HEAD가 origin/main의 조상
# 항상 남기는 것: 본 트리, 커밋 안 한 변경이 있는 곳, ignored 파일(데이터 산출물 등)이 있는 곳
#
# node_modules 정션은 git worktree remove 전에 링크만 끊는다.
# 순서가 바뀌면 정션 너머 원본 node_modules가 지워진다.
set -u

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

MAIN_TREE=$(git worktree list --porcelain | awk '/^worktree/{print $2; exit}')
git -C "$MAIN_TREE" fetch --prune -q origin || { echo "fetch 실패" >&2; exit 1; }

removed=0
kept=0

keep() { echo "  남김: $1"; kept=$((kept + 1)); }

# 정션/심링크인 node_modules만 링크째 삭제. Directory.Delete(비재귀)는 링크만 지우고 대상은 안 건드린다.
# 하나라도 못 끊으면 실패를 돌려준다 — 호출 쪽은 그 워크트리를 절대 지우면 안 된다.
unlink_junctions() {
  local wt=$1 link win
  while IFS= read -r link; do
    [ -L "$link" ] || continue
    win=$(cygpath -w "$link")
    powershell -NoProfile -Command "[System.IO.Directory]::Delete('$win', \$false)" >/dev/null 2>&1
    if [ -e "$link" ] || [ -L "$link" ]; then
      echo "  정션 끊기 실패: ${link#$wt/}"
      return 1
    fi
    echo "  정션 끊음: ${link#$wt/}"
  done < <(find "$wt" -maxdepth 3 -name node_modules -type l 2>/dev/null)
}

while IFS='|' read -r wt branch; do
  [ "$wt" = "$MAIN_TREE" ] && continue
  echo "[$wt] ${branch:-(detached)}"

  if [ ! -d "$wt" ]; then
    echo "  폴더 없음 → prune 대상"
    continue
  fi
  if [ -n "$(git -C "$wt" status --porcelain)" ]; then
    keep "커밋 안 한 변경 있음"; continue
  fi
  ignored=$(git -C "$wt" status --porcelain --ignored | grep '^!!' | grep -Ev '(node_modules|__pycache__|\.pytest_cache)/$')
  if [ -n "$ignored" ]; then
    keep "ignored 파일 있음 (확인 후 직접 정리):"
    echo "$ignored" | head -5 | sed 's/^/      /'
    continue
  fi

  head=$(git -C "$wt" rev-parse HEAD)
  if [ -z "$branch" ]; then
    if ! git merge-base --is-ancestor "$head" origin/main; then
      keep "detached HEAD가 main에 없음"; continue
    fi
    reason="detached, main에 포함"
  else
    pr=$(gh pr list --head "$branch" --state merged --json number,headRefOid,mergeCommit \
      -q '.[0] // empty | "\(.number) \(.headRefOid) \(.mergeCommit.oid)"' 2>/dev/null)
    if [ -z "$pr" ]; then
      keep "병합된 PR 없음"; continue
    fi
    read -r num pr_head merge_oid <<<"$pr"
    if ! git merge-base --is-ancestor "$merge_oid" origin/main 2>/dev/null; then
      keep "#$num 병합 커밋이 main에 없음"; continue
    fi
    if [ "$head" != "$pr_head" ]; then
      keep "#$num 이후 로컬 커밋 $(git rev-list --count "$pr_head..$head" 2>/dev/null || echo '?')개 더 있음"; continue
    fi
    reason="#$num 병합됨"
  fi

  if [ $APPLY -eq 0 ]; then
    echo "  지울 예정 ($reason)"
    removed=$((removed + 1)); continue
  fi

  if ! unlink_junctions "$wt"; then
    keep "정션을 못 끊어서 건드리지 않음 (원본 node_modules 보호)"; continue
  fi
  if git worktree remove "$wt"; then
    echo "  제거됨 ($reason)"
    [ -n "$branch" ] && git branch -D "$branch" >/dev/null && echo "  브랜치 삭제: $branch"
    removed=$((removed + 1))
  else
    keep "worktree remove 실패 (다른 프로그램이 폴더를 열고 있을 수 있음)"
  fi
done < <(git worktree list --porcelain | awk '
  /^worktree /{p=substr($0,10); b=""}
  /^branch /{b=substr($0,8); sub("refs/heads/","",b)}
  /^$/{print p"|"b}
  END{if(p!="") print p"|"b}' | sort -u)

if [ $APPLY -eq 1 ]; then
  git worktree prune
  echo "완료: 제거 $removed, 남김 $kept"
else
  echo "미리보기: 지울 예정 $removed, 남김 $kept  (실행하려면 --apply)"
fi
