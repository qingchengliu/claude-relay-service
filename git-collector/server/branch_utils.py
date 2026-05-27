import re


RE_REQUIREMENT_BRANCH = re.compile(r"^rel_.*_(\d+)$")


def normalize_branch_name(branch: str | None) -> str | None:
    if not isinstance(branch, str):
        return None
    branch = branch.strip()
    for prefix in ("refs/heads/", "refs/remotes/origin/", "origin/"):
        if branch.startswith(prefix):
            branch = branch[len(prefix):]
            break
    return branch or None


def extract_requirement_id(branch: str | None) -> int | None:
    branch = normalize_branch_name(branch)
    if not branch:
        return None
    match = RE_REQUIREMENT_BRANCH.match(branch)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None
