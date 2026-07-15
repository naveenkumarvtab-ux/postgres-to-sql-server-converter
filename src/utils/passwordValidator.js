/**
 * Validates password complexity based on security checklist:
 * 1. At least 12 characters
 * 2. Exceeding 128 characters is denied (max 128)
 * 3. Requires lowercase, uppercase, number, and special character
 */
export function validatePassword(password) {
  if (!password) {
    return 'Password is required.';
  }
  if (password.length < 12) {
    return 'Password must be at least 12 characters in length.';
  }
  if (password.length > 128) {
    return 'Password cannot exceed 128 characters in length.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number.';
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one special character (e.g., @, #, $, etc.).';
  }
  return null;
}
