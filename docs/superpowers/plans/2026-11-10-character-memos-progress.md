# Progress: 2026-11-10-character-memos

- Core store/API/recall and UI implemented. Initial eight behavior tests failed before the module existed, then passed.
- Reproduced prior full viewport summary shell; expanded batch controls moved into same scroll form, nonshrinking sections. Inset shell browser tested 320/390/402/768 and 420px short height.
- Independent fresh review found six defects; added failing tests for all six and manual unlock correction, then fixed all seven. Canonical suppression, conservative speaker checks, cloned-state rollback, commit-time review mode, full pending-count thresholds, approval source validation.
- Journal clone rollback uses the same ownership rule and is covered by browser failure simulation.
- Ruling: source quotes without clear first-person ownership go to review rather than automatic confirmation. Cost: more manual review for elliptical statements.
- Ruling: deleting with suppression ignores cited source messages too. Cost: other facts from that same source may require explicit unignore.
- Ruling: unlocking an edited original permits deliberate approval of a replacement; automatic extraction still cannot supersede it. Cost: user approval can replace their prior edit.
- No deferred reviewer findings. Final checks and push recorded in final delivery.

Final verification: npm test 1107/1107; baseline comparison 31/31; expanded summary/memo browser journey passed; approved atlas viewport and protected artwork/cards/music pixel checks passed. Quote ownership regression added and fixed. Final fresh reviewer findings all addressed.
