// Authentication & Authorization — Role-based access control
// FO: secretariaat, screenteam, applicatiebeheerder, label-eigenaar
//
// Usage:
//   import { requireRole, requireAuth, generateToken } from './auth.js';
//   app.get('/api/protected', requireRole('secretariaat'), handler);
//   app.get('/api/admin', requireRole('beheer'), handler);

import crypto from 'node:crypto';

// ============ CONFIGURATION ============

// In production, use a proper secret from environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'forta-match-dev-secret-change-in-production';
const TOKEN_EXPIRY_HOURS = 24;

// Demo users for development (in production, use a real user database)
const DEMO_USERS = {
  'maria': { id: 1, name: 'Maria Boom', role: 'secretariaat', password: 'demo123' },
  'jan': { id: 2, name: 'Jan de Vries', role: 'screenteam', password: 'demo123' },
  'admin': { id: 3, name: 'Admin User', role: 'beheer', password: 'admin123' },
  'eigenaar': { id: 4, name: 'Label Eigenaar', role: 'label_eigenaar', labels: [1, 2], password: 'demo123' }
};

// ============ ROLE DEFINITIONS ============

const ROLES = {
  secretariaat: {
    name: 'Secretariaat',
    permissions: [
      'cases.read',
      'cases.create',
      'cases.match',
      'cases.decision',
      'cases.recheck',
      'cases.terugstuurbrief',
      'explore',
      'feedback.create',
      'feedback.read'
    ]
  },
  screenteam: {
    name: 'Screenteam',
    permissions: [
      'screen.read',
      'cases.read',
      'cases.decision',
      'questions.read',
      'questions.create',
      'questions.update',
      'questions.delete',
      'belkaartje.read',
      'feedback.create',
      'feedback.read'
    ]
  },
  beheer: {
    name: 'Applicatiebeheerder',
    permissions: [
      'labels.read',
      'labels.create',
      'labels.update',
      'tags.read',
      'tags.create',
      'tags.update',
      'tags.delete',
      'modus.read',
      'modus.update',
      'voorkeuren.read',
      'voorkeuren.create',
      'voorkeuren.delete',
      'audit.read',
      'dashboard.read',
      'users.read' // Can view user list but not modify
    ]
  },
  label_eigenaar: {
    name: 'Label-eigenaar',
    permissions: [
      'labels.own.read',
      'labels.own.update',
      'locations.own.read',
      'locations.own.update',
      'dashboard.own.read'
    ]
  }
};

// Route-to-permission mapping
const ROUTE_PERMISSIONS = {
  // Cases
  'GET /api/cases': 'cases.read',
  'POST /api/cases': 'cases.create',
  'GET /api/cases/:id': 'cases.read',
  'POST /api/cases/:id/match': 'cases.match',
  'POST /api/cases/:id/decision': 'cases.decision',
  'POST /api/cases/:id/recheck': 'cases.recheck',
  'POST /api/cases/:id/terugstuurbrief': 'cases.terugstuurbrief',

  // Screenteam
  'GET /api/screen/cases': 'screen.read',
  'GET /api/cases/:id/questions': 'questions.read',
  'POST /api/cases/:id/questions': 'questions.create',
  'PUT /api/cases/:id/questions/:qid': 'questions.update',
  'DELETE /api/cases/:id/questions/:qid': 'questions.delete',
  'GET /api/cases/:id/belkaartje': 'belkaartje.read',

  // Explore
  'POST /api/explore': 'explore',

  // Feedback
  'POST /api/cases/:id/feedback/turn': 'feedback.create',
  'POST /api/cases/:id/feedback/save': 'feedback.create',

  // Admin - Labels
  'GET /api/labels': 'labels.read',
  'POST /api/labels': 'labels.create',
  'PUT /api/labels/:id': 'labels.update',

  // Admin - Tags
  'GET /api/tags': 'tags.read',
  'POST /api/tags': 'tags.create',
  'PUT /api/tags/:id': 'tags.update',
  'DELETE /api/tags/:id': 'tags.delete',

  // Admin - Modus
  'GET /api/modus': 'modus.read',
  'PUT /api/modus': 'modus.update',

  // Admin - Voorkeuren
  'GET /api/voorkeuren': 'voorkeuren.read',
  'POST /api/voorkeuren': 'voorkeuren.create',
  'DELETE /api/voorkeuren/:id': 'voorkeuren.delete',

  // Admin - Audit & Dashboard
  'GET /api/audit': 'audit.read',
  'GET /api/dashboard': 'dashboard.read'
};

// ============ TOKEN FUNCTIONS ============

/**
 * Simple JWT-like token generation (base64 encoded JSON with HMAC signature)
 * In production, use a proper JWT library like jsonwebtoken
 */
export function generateToken(user) {
  const payload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    labels: user.labels || [],
    iat: Date.now(),
    exp: Date.now() + (TOKEN_EXPIRY_HOURS * 60 * 60 * 1000)
  };

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Verify and decode a token
 */
export function verifyToken(token) {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, signature] = parts;

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());

    // Check expiry
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ============ MIDDLEWARE ============

/**
 * Extract user from request (token in Authorization header or cookie)
 */
function extractUser(req) {
  // Try Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return verifyToken(token);
  }

  // Try cookie
  const cookieToken = req.cookies?.forta_token;
  if (cookieToken) {
    return verifyToken(cookieToken);
  }

  // For development: allow role override via header (disable in production!)
  if (process.env.NODE_ENV !== 'production') {
    const devRole = req.headers['x-forta-role'];
    const devName = req.headers['x-forta-name'] || 'Dev User';
    if (devRole && ROLES[devRole]) {
      return { sub: 0, name: devName, role: devRole, labels: [], dev: true };
    }
  }

  return null;
}

/**
 * Middleware: Require authentication (any valid user)
 */
export function requireAuth(req, res, next) {
  const user = extractUser(req);

  if (!user) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }

  req.user = user;
  next();
}

/**
 * Middleware: Require specific role(s)
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const user = extractUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
        code: 'FORBIDDEN',
        required_roles: allowedRoles,
        your_role: user.role
      });
    }

    req.user = user;
    next();
  };
}

/**
 * Middleware: Require specific permission
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    const user = extractUser(req);

    if (!user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    const roleConfig = ROLES[user.role];
    if (!roleConfig) {
      return res.status(403).json({
        error: 'Invalid role',
        code: 'INVALID_ROLE'
      });
    }

    // Check if user has the required permission
    const hasPermission = roleConfig.permissions.includes(permission) ||
                          roleConfig.permissions.includes('*');

    // Special handling for label-eigenaar: check ownership
    if (!hasPermission && user.role === 'label_eigenaar') {
      // Check if this is an "own" permission they can use
      const ownPermission = permission.replace(/^(\w+)\./, '$1.own.');
      if (roleConfig.permissions.includes(ownPermission)) {
        // They have the "own" version - will need to verify ownership in handler
        req.user = user;
        req.requiresOwnershipCheck = true;
        return next();
      }
    }

    if (!hasPermission) {
      return res.status(403).json({
        error: `Access denied. Required permission: ${permission}`,
        code: 'FORBIDDEN',
        required_permission: permission,
        your_role: user.role
      });
    }

    req.user = user;
    next();
  };
}

/**
 * Middleware: Optional authentication (sets req.user if valid token present)
 */
export function optionalAuth(req, res, next) {
  const user = extractUser(req);
  if (user) {
    req.user = user;
  }
  next();
}

// ============ AUTH ROUTES ============

/**
 * Login handler (for demo purposes)
 * In production, integrate with your identity provider
 */
export function loginHandler(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = DEMO_USERS[username.toLowerCase()];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      labels: user.labels || []
    },
    expires_in: TOKEN_EXPIRY_HOURS * 60 * 60
  });
}

/**
 * Get current user info
 */
export function meHandler(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const roleConfig = ROLES[req.user.role] || {};

  res.json({
    user: {
      id: req.user.sub,
      name: req.user.name,
      role: req.user.role,
      role_name: roleConfig.name,
      labels: req.user.labels || [],
      permissions: roleConfig.permissions || []
    }
  });
}

/**
 * Helper to register auth routes on an Express app
 */
export function registerAuthRoutes(app) {
  app.post('/api/auth/login', loginHandler);
  app.get('/api/auth/me', requireAuth, meHandler);

  // Logout just tells client to clear token (stateless)
  app.post('/api/auth/logout', (req, res) => {
    res.json({ ok: true, message: 'Clear token on client side' });
  });
}

// ============ EXPORTS ============

export {
  ROLES,
  ROUTE_PERMISSIONS,
  DEMO_USERS
};
