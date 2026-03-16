export interface ParsedRepository {
  owner: string;
  repo: string;
}

export function parseOwnerRepo(repository: string): ParsedRepository | null {
  const [owner, repo, extra] = repository.split('/');
  if (
    owner === undefined ||
    repo === undefined ||
    extra !== undefined ||
    owner.length === 0 ||
    repo.length === 0
  ) {
    return null;
  }

  return { owner, repo };
}
