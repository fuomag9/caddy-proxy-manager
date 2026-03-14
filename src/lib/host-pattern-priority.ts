type HostPatternInfo = {
  normalized: string;
  wildcard: boolean;
  labelCount: number;
  suffixLength: number;
};

type RouteMatch = {
  host?: string[];
  path?: string[];
};

type RouteLike = {
  match?: RouteMatch[];
};

type TlsPolicyLike = {
  match?: {
    sni?: string[];
  };
};

type AutomationPolicyLike = {
  subjects?: string[];
};

function normalizeHostPattern(pattern: string) {
  return pattern.trim().toLowerCase().replace(/\.$/, "");
}

function getHostPatternInfo(pattern: string): HostPatternInfo {
  const normalized = normalizeHostPattern(pattern);
  const wildcard = normalized.startsWith("*.");
  const suffix = wildcard ? normalized.slice(2) : normalized;

  return {
    normalized,
    wildcard,
    labelCount: suffix ? suffix.split(".").length : 0,
    suffixLength: suffix.length,
  };
}

function getHostPriorityKey(info: HostPatternInfo) {
  return `${info.wildcard ? "wildcard" : "exact"}:${info.labelCount}`;
}

function getPathPriority(paths: string[]) {
  if (paths.length === 0) {
    return { hasPath: false, wildcard: true, length: 0 };
  }

  return paths.reduce(
    (best, path) => {
      const wildcard = path.endsWith("*");
      const candidate = {
        hasPath: true,
        wildcard,
        length: path.length,
      };

      if (!best.hasPath) {
        return candidate;
      }

      if (best.wildcard !== candidate.wildcard) {
        return candidate.wildcard ? best : candidate;
      }

      if (candidate.length !== best.length) {
        return candidate.length > best.length ? candidate : best;
      }

      return best;
    },
    { hasPath: false, wildcard: true, length: 0 }
  );
}

export function compareHostPatterns(a: string, b: string) {
  const infoA = getHostPatternInfo(a);
  const infoB = getHostPatternInfo(b);

  if (infoA.wildcard !== infoB.wildcard) {
    return infoA.wildcard ? 1 : -1;
  }

  if (infoA.labelCount !== infoB.labelCount) {
    return infoB.labelCount - infoA.labelCount;
  }

  if (infoA.suffixLength !== infoB.suffixLength) {
    return infoB.suffixLength - infoA.suffixLength;
  }

  return infoA.normalized.localeCompare(infoB.normalized);
}

export function groupHostPatternsByPriority(patterns: string[]) {
  const sorted = [...patterns].sort(compareHostPatterns);
  const groups: string[][] = [];

  for (const pattern of sorted) {
    const info = getHostPatternInfo(pattern);
    const key = getHostPriorityKey(info);
    const currentGroup = groups[groups.length - 1];

    if (!currentGroup) {
      groups.push([info.normalized]);
      continue;
    }

    const currentKey = getHostPriorityKey(getHostPatternInfo(currentGroup[0]));
    if (currentKey === key) {
      currentGroup.push(info.normalized);
      continue;
    }

    groups.push([info.normalized]);
  }

  return groups;
}

export function sortRoutesByHostPriority<T extends RouteLike>(routes: T[]) {
  return routes
    .map((route, index) => ({ route, index }))
    .sort((left, right) => {
      const leftHosts = (left.route.match ?? []).flatMap((match) => match.host ?? []);
      const rightHosts = (right.route.match ?? []).flatMap((match) => match.host ?? []);

      if (leftHosts.length > 0 && rightHosts.length > 0) {
        const hostComparison = compareHostPatterns(leftHosts[0], rightHosts[0]);
        if (hostComparison !== 0) {
          return hostComparison;
        }
      } else if (leftHosts.length !== rightHosts.length) {
        return rightHosts.length - leftHosts.length;
      }

      const leftPaths = (left.route.match ?? []).flatMap((match) => match.path ?? []);
      const rightPaths = (right.route.match ?? []).flatMap((match) => match.path ?? []);
      const leftPathPriority = getPathPriority(leftPaths);
      const rightPathPriority = getPathPriority(rightPaths);

      if (leftPathPriority.hasPath !== rightPathPriority.hasPath) {
        return leftPathPriority.hasPath ? -1 : 1;
      }

      if (leftPathPriority.wildcard !== rightPathPriority.wildcard) {
        return leftPathPriority.wildcard ? 1 : -1;
      }

      if (leftPathPriority.length !== rightPathPriority.length) {
        return rightPathPriority.length - leftPathPriority.length;
      }

      return left.index - right.index;
    })
    .map(({ route }) => route);
}

export function sortTlsPoliciesBySniPriority<T extends TlsPolicyLike>(policies: T[]) {
  return [...policies].sort((left, right) => {
    const leftSni = left.match?.sni ?? [];
    const rightSni = right.match?.sni ?? [];

    if (leftSni.length > 0 && rightSni.length > 0) {
      return compareHostPatterns(leftSni[0], rightSni[0]);
    }

    return rightSni.length - leftSni.length;
  });
}

export function sortAutomationPoliciesBySubjectPriority<T extends AutomationPolicyLike>(policies: T[]) {
  return [...policies].sort((left, right) => {
    const leftSubjects = left.subjects ?? [];
    const rightSubjects = right.subjects ?? [];

    if (leftSubjects.length > 0 && rightSubjects.length > 0) {
      return compareHostPatterns(leftSubjects[0], rightSubjects[0]);
    }

    return rightSubjects.length - leftSubjects.length;
  });
}
