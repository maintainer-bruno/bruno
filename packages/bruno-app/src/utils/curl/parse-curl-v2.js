import cookie from 'cookie';
import URL from 'url';
import querystring from 'query-string';
import { parse } from 'shell-quote';
import { isEmpty } from 'lodash';

/**
 * Parse a curl command into a request object
 *
 * @TODO
 * - Handle T (file upload)
 * - Handle G and GET (change data to query string)
 * - Handle header cookies (set cookie object)
 *
 * - Handle multiple -b flags (multiple cookies)
 * - Handle multiple -F flags (multiple form fields)
 */
const parseCurlCommand = (curl) => {
  // Clean up the curl command first
  const curlCommand = cleanCurlCommand(curl);

  // Parse the command into individual arguments
  const parsedArgs = parse(curlCommand);

  // Build the request object by processing each argument
  const request = buildRequest(parsedArgs);

  // Clean up the final request
  return normalizeRequest(request);
};

/**
 * Build request object by processing parsed arguments
 */
const buildRequest = (parsedArgs) => {
  let state = null;
  const request = { method: 'GET', headers: {} };

  // Process each argument in the curl command
  for (const arg of parsedArgs) {
    switch (true) {
      // Handle URLs - check if this looks like a URL or URL fragment
      case !state && (isURL(arg) || isURLFragment(arg)):
        setURL(request, arg);
        break;

      // Handle User-Agent flag
      case arg === '-A' || arg === '--user-agent':
        state = 'user-agent';
        break;

      // Handle Header flag
      case arg === '-H' || arg === '--header':
        state = 'header';
        break;

      // Handle Data flags
      case arg === '-d' || arg === '--data' || arg === '--data-ascii' || arg === '--data-urlencode' || arg === '--data-raw' || arg === '--data-binary':
        if (arg === '--data-binary') request.isDataBinary = true;
        if (arg === '--data-raw') request.isDataRaw = true;
        state = 'data';
        break;

      case arg === '--json':
        state = 'json';
        break;

      // Handle User/Auth flag
      case arg === '-u' || arg === '--user':
        state = 'user';
        break;

      // Handle HEAD method flag
      case arg === '-I' || arg === '--head':
        request.method = 'HEAD';
        break;

      // Handle Request method flag
      case arg === '-X' || arg === '--request':
        state = 'method';
        break;

      // Handle Cookie flag
      case arg === '-b' || arg === '--cookie':
        state = 'cookie';
        break;

      // Handle Form flag
      case arg === '-F' || arg === '--form':
        state = 'form';
        break;

      // Handle Compressed flag
      case arg === '--compressed':
        request.headers['Accept-Encoding'] = request.headers['Accept-Encoding'] || 'deflate, gzip';
        break;

      case arg === '-k' || arg === '--insecure':
        request.insecure = true;
        break;

      // Handle values based on current state
      case !!arg && state !== null:
        handleValue(arg, state, request);
        state = null;
        break;
    }
  }

  return request;
};

/**
 * Handle values based on the current parsing state
 */
const handleValue = (value, state, request) => {
  switch (state) {
    case 'header':
      // Parse header field (e.g., "Content-Type: application/json")
      const [headerName, headerValue] = value.split(/: (.+)/);
      request.headers[headerName] = headerValue;
      break;

    case 'user-agent':
      request.headers['User-Agent'] = value;
      break;

    case 'data':
    case 'json':
      // If we have data with GET/HEAD, change to POST (curl behavior)
      if (request.method === 'GET' || request.method === 'HEAD') {
        request.method = 'POST';
      }
      if (state === 'json') {
        request.headers['Content-Type'] = 'application/json';
      }
      // Append data (multiple -d flags are joined with &)
      request.data = request.data ? request.data + '&' + value : value;
      break;

    case 'form':
      setFormData(request, value);
      request.method = 'POST';
      break;

    case 'user':
      setAuth(request, value);
      break;

    case 'method':
      request.method = value.toUpperCase();
      break;

    case 'cookie':
      setCookie(request, value);
      break;

    default:
      break;
  }
};

/**
 * Check if argument looks like a URL
 */
const isURL = (arg) => {
  if (typeof arg !== 'string') {
    return false;
  }

  return !!URL.parse(arg || '').host;
};

/**
 * Check if argument looks like a URL fragment (part of a URL with query parameters)
 */
const isURLFragment = (arg) => {
  // Check if it's a glob pattern object (from shell-quote)
  if (arg && typeof arg === 'object' && arg.op === 'glob') {
    return !!URL.parse(arg.pattern || '').host;
  }
  // Check if it's an operator object (part of URL query string)
  if (arg && typeof arg === 'object' && arg.op === '&') {
    return true;
  }
  // Check if it's a string that contains query parameter patterns
  if (typeof arg === 'string') {
    // Look for patterns like "key=value" (query parameters)
    return /^[^=]+=[^&]*$/.test(arg);
  }
  return false;
};

/**
 * Set URL and related properties
 */
const setURL = (request, url) => {
  // Convert URL fragment to string
  const urlString = getUrlString(url);
  if (!urlString) return;

  // Concatenate with existing URL or set as new URL
  request.url = request.url ? request.url + urlString : urlString;

  // Update urlWithoutQuery if we have a complete URL
  updateUrlWithoutQuery(request);
};

/**
 * Convert URL fragment to string
 */
const getUrlString = (url) => {
  if (typeof url === 'string') return url;
  if (url?.op === 'glob') return url.pattern;
  if (url?.op === '&') return '&';
  return null;
};

/**
 * Update urlWithoutQuery property
 */
const updateUrlWithoutQuery = (request) => {
  if (!request.url || !URL.parse(request.url).host) return;

  const urlObject = URL.parse(request.url);
  urlObject.search = null; // Remove query string

  let urlWithoutQuery = URL.format(urlObject);
  const urlHost = urlObject?.host;

  // Fix URL formatting if needed (preserve original logic)
  if (!request.url?.includes(`${urlHost}/`)) {
    if (urlWithoutQuery && urlHost) {
      const [beforeHost, afterHost] = urlWithoutQuery.split(urlHost);
      urlWithoutQuery = beforeHost + urlHost + afterHost?.slice(1);
    }
  }

  request.urlWithoutQuery = urlWithoutQuery;
};

/**
 * Set form data for multipart uploads
 */
const setFormData = (request, formArg) => {
  const formArray = Array.isArray(formArg) ? formArg : [formArg];
  const multipartUploads = [];

  formArray.forEach((field) => {
    // Parse form field: name=value, name=@file, or name=@"file"
    const match = field.match(/^([^=]+)=(?:@?"([^"]*)"|@([^@]*)|([^@]*))?$/);

    if (match) {
      const fieldName = match[1];
      // Check for quoted file path, unquoted file path, or regular value
      const fieldValue = match[2] || match[3] || match[4] || '';
      const isFile = field.includes('@');

      multipartUploads.push({
        name: fieldName,
        value: fieldValue,
        type: isFile ? 'file' : 'text',
        enabled: true
      });
    }
  });

  request.multipartUploads = request.multipartUploads || [];
  request.multipartUploads.push(...multipartUploads);
};

/**
 * Set authentication credentials
 */
const setAuth = (request, authString) => {
  const [username, password] = authString.split(':');
  request.auth = {
    mode: 'basic',
    basic: {
      username: username || '',
      password: password || ''
    }
  };
};

const setCookie = (request, cookies) => {
  const parsedCookies = cookie.parse(cookies);
  request.cookies = parsedCookies;
  request.cookieString = cookies;

  request.headers['Cookie'] = cookies;
};

/**
 * Clean up curl command by handling escape sequences, newlines, whitespace, and concatenated HTTP methods
 */
const cleanCurlCommand = (curlCommand) => {
  // Handle escape sequences like $'cookie: value'
  curlCommand = curlCommand.replace(/\$('.*')/g, (match, group) => group);

  // Remove newlines and line continuations
  curlCommand = curlCommand.replace(/\\\r|\\\n/g, '');

  // Remove extra whitespace
  curlCommand = curlCommand.replace(/\s+/g, ' ');

  // Convert escaped single quotes to shell quote pattern: \' -> '\''
  // This preserves shell compatibility while handling escaped quotes in JSON/data
  curlCommand = curlCommand.replace(/\\'(?!')/g, "'\\''");

  // Fix concatenated HTTP methods (like -XPOST -> -X POST)
  const methodFixes = [
    { from: / -XPOST/, to: ' -X POST' },
    { from: / -XGET/, to: ' -X GET' },
    { from: / -XPUT/, to: ' -X PUT' },
    { from: / -XPATCH/, to: ' -X PATCH' },
    { from: / -XDELETE/, to: ' -X DELETE' },
    { from: / -XOPTIONS/, to: ' -X OPTIONS' },
    { from: / -XHEAD/, to: ' -X HEAD' },
    { from: / -Xnull/, to: ' ' } // Safari adds this when it can't determine method
  ];

  methodFixes.forEach(({ from, to }) => {
    curlCommand = curlCommand.replace(from, to);
  });

  return curlCommand.trim();
};

/**
 * Clean up the final request object
 */
const normalizeRequest = (request) => {
  // Convert method to lowercase
  request.method = request.method.toLowerCase();

  // Remove empty headers object
  if (isEmpty(request.headers)) {
    delete request.headers;
  }

  return request;
};

export default parseCurlCommand;
