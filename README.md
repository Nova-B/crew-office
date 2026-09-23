# Crew Office

Claude Code·Codex 세션이 각자 직원을 맡아 3D 사무실에서 서로 대화하며 일하는 로컬 앱.

> **수정본 고지 (Modification notice)**
> 이 저장소는 [Dante Labs](https://dante-labs.com)의 [DeskRPG](https://github.com/dandacompany/deskrpg)
> 커밋 `4d6306c4`를 **수정한 버전**입니다. 원본은 커밋 `53b3995`에 수정 없이 들어 있고, 이후 커밋이 변경 사항입니다.
> This repository is a **modified version** of DeskRPG by Dante Labs (upstream commit `4d6306c4`).
>
> 원본과 이 수정본은 [`LICENSE.md`](LICENSE.md)의 Sustainable Use License를 따릅니다.
> 개인·비상업 또는 자체 내부 용도로만 쓸 수 있고, 배포는 무료·비상업일 때만 가능합니다.

## 현재 상태

개발 초기 단계입니다. 아직 DeskRPG에서 크게 바뀌지 않았습니다.

- 0단계 검증 결과: [`spikes/phase0/RESULTS.md`](spikes/phase0/RESULTS.md)
- 원본 DeskRPG 안내(설치·실행·Hermes 연결): [`README.upstream.md`](README.upstream.md) / [한국어](README.upstream.ko.md)

## 방향

- Hermes 게이트웨이 없이, 이 PC에 설치된 Claude Code·Codex CLI를 직원 세션으로 직접 실행한다.
- 직원 한 명 = CLI 세션 하나. 세션 ID를 저장해 재시작 후에도 기억을 유지한다.
- 직원끼리는 앱이 여는 로컬 MCP 서버(사내 메신저)를 통해 묻고 답한다.
- Windows 로컬 단일 사용자 앱을 우선한다.
