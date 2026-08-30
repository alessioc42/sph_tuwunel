/**
 * Parse SPH-encoded Basic-Auth usernames.
 *
 * Format from extras/schulportallogin.php:
 *   YYYYMMDDHHmmss-<payload...>-uniqid
 * Lehrer:  ...-<Login...>-L-<Kuerzel>-uniqid  (after stripping timestamp + uniqid)
 * Schueler: ...-<Login...>-<Klasse>-<Stufe>-uniqid
 *
 * When identity handoff is disabled, username is just timestamp-uniqid (2 parts).
 */

export type SphIdentity =
  | { kind: "anonymous"; raw: string }
  | {
      kind: "lehrer";
      login: string;
      kuerzel: string;
      raw: string;
    }
  | {
      kind: "schueler";
      login: string;
      klasse: string;
      stufe: string;
      raw: string;
    }
  | { kind: "opaque"; loginHint: string; raw: string };

export function parseSphUsername(authUser: string): SphIdentity {
  const parts = authUser.split("-");
  if (parts.length <= 2) {
    return { kind: "anonymous", raw: authUser };
  }

  // Drop timestamp (first) and uniqid (last), matching getUser().
  const middle = parts.slice(1, -1);
  if (middle.length === 0) {
    return { kind: "anonymous", raw: authUser };
  }

  if (middle.length === 1) {
    return { kind: "opaque", loginHint: middle[0]!, raw: authUser };
  }

  if (middle[middle.length - 2] === "L") {
    const kuerzel = middle[middle.length - 1]!;
    const login = middle.slice(0, -2).join("-");
    return { kind: "lehrer", login, kuerzel, raw: authUser };
  }

  const stufe = middle[middle.length - 1]!;
  const klasse = middle[middle.length - 2]!;
  const login = middle.slice(0, -2).join("-");
  return { kind: "schueler", login, klasse, stufe, raw: authUser };
}

/** Map SPH identity to a Matrix MXID localpart. */
export function toMatrixLocalpart(identity: SphIdentity, folder: string): string {
  const sanitize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9._=-]/g, ".")
      .replace(/\.+/g, ".")
      .replace(/^\.|\.$/g, "")
      .slice(0, 64) || "user";

  switch (identity.kind) {
    case "lehrer":
      return sanitize(identity.login);
    case "schueler":
      return sanitize(identity.login);
    case "opaque":
      return sanitize(identity.loginHint);
    case "anonymous":
      return sanitize(`guest.${folder}.${identity.raw.slice(0, 12)}`);
  }
}
