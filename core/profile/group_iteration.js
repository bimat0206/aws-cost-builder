export function* iterGroups(groups) {
  for (const group of groups) {
    yield group;
    if (group.getGroups && group.getGroups().length > 0) {
      yield* iterGroups(group.getGroups());
    }
  }
}
