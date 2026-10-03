// In-memory stand-ins for Forge KVS and the Jira/JSM REST endpoints Smart
// Approval calls, so the real resolvers and workers run unmodified in tests.

export const route = (strings, ...values) =>
  strings.reduce((out, part, i) => out + part + (i < values.length ? encodeURIComponent(values[i]) : ''), '');

export function createFakeKvs() {
  const data = new Map();
  const query = () => {
    const state = { prefix: '', limit: 10, cursor: 0 };
    const builder = {
      where: (_property, condition) => { state.prefix = condition.beginsWith; return builder; },
      limit: (n) => { state.limit = n; return builder; },
      cursor: (c) => { state.cursor = Number(c); return builder; },
      getMany: async () => {
        const keys = [...data.keys()].filter((k) => k.startsWith(state.prefix)).sort();
        const page = keys.slice(state.cursor, state.cursor + state.limit);
        const next = state.cursor + page.length;
        return { results: page.map((key) => ({ key, value: structuredClone(data.get(key)) })), nextCursor: next < keys.length ? String(next) : undefined };
      },
    };
    return builder;
  };
  return {
    data,
    kvs: {
      get: async (key) => (data.has(key) ? structuredClone(data.get(key)) : undefined),
      set: async (key, value) => { data.set(key, structuredClone(value)); },
      delete: async (key) => { data.delete(key); },
      query,
    },
    WhereConditions: { beginsWith: (prefix) => ({ beginsWith: prefix }) },
  };
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
  json: async () => body,
});

// issues: { [key]: { projectId, status, category ('new'|'indeterminate'|'done'), summary } }
// transitions: { [key]: [{ id, to: statusName, category }] } available from any status
export function createFakeJira({ issues = {}, users = {}, transitions = {}, forms = {} } = {}) {
  const comments = [];
  const applied = [];
  const calls = [];
  const properties = {};

  async function requestJira(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const url = new URL(String(path), 'https://jira.test');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ method, path: url.pathname });
    let m;

    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)$/.exec(url.pathname)) && method === 'GET') {
      const issue = issues[decodeURIComponent(m[1])];
      if (!issue) return response(404, { errorMessages: ['Issue does not exist'] });
      return response(200, {
        id: `id-${m[1]}`, key: decodeURIComponent(m[1]),
        fields: {
          summary: issue.summary || 'Summary',
          project: { id: issue.projectId, key: 'SD' },
          status: { name: issue.status, statusCategory: { key: issue.category } },
          reporter: { accountId: 'reporter' },
        },
      });
    }
    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/.exec(url.pathname))) {
      const key = decodeURIComponent(m[1]);
      const available = transitions[key] || [];
      if (method === 'GET') return response(200, { transitions: available.map((t) => ({ id: t.id, to: { name: t.to } })) });
      const chosen = available.find((t) => t.id === body.transition.id);
      if (!chosen) return response(400, { errorMessages: ['Invalid transition'] });
      applied.push({ issueKey: key, to: chosen.to });
      Object.assign(issues[key], { status: chosen.to, category: chosen.category || 'indeterminate' });
      return response(204);
    }
    if (url.pathname === '/rest/api/3/user' && method === 'GET') {
      const accountId = url.searchParams.get('accountId');
      return response(200, { accountId, displayName: users[accountId] || `${accountId} name`, active: true });
    }
    if ((m = /^\/rest\/servicedeskapi\/request\/([^/]+)\/comment$/.exec(url.pathname)) && method === 'POST') {
      comments.push({ issueKey: decodeURIComponent(m[1]), body: body.body, public: body.public });
      return response(201, {});
    }
    if (/^\/rest\/servicedeskapi\/request\/[^/]+\/participant$/.test(url.pathname)) return response(200, {});
    if ((m = /^\/rest\/api\/3\/issue\/([^/]+)\/properties\/([^/]+)$/.exec(url.pathname)) && method === 'PUT') {
      properties[`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`] = body;
      return response(200, {});
    }
    if ((m = /^\/forms\/issue\/([^/]+)\/form$/.exec(url.pathname)) && method === 'GET') {
      return response(200, forms[decodeURIComponent(m[1])] || []);
    }
    throw new Error(`Unexpected Jira call: ${method} ${url.pathname}`);
  }

  return { issues, comments, applied, calls, properties, requestJira };
}
