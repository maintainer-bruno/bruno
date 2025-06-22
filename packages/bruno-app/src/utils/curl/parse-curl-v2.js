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
 * - Handle header cookies (set cookie object)
 *
 * - Handle multiple -b flags (multiple cookies)
 * - Handle multiple -F flags (multiple form fields)
 */
const parseCurlCommand = (curl) => {
  const cleanedCommand = cleanCurlCommand(curl);
  const parsedArgs = parse(cleanedCommand);
  const request = buildRequest(parsedArgs);

  return normalizeRequest(postBuildProcessRequest(request));
};

/**
 * Build request object by processing parsed arguments
 * Uses a state machine pattern to handle flag-value pairs
 */
const buildRequest = (parsedArgs) => {
  const request = { headers: {} };
  let currentState = null;

  for (const arg of parsedArgs) {
    const newState = processArgument(arg, currentState, request);
    // Reset state after handling a value, or update to new state
    if (currentState && !newState) {
      currentState = null;
    } else if (newState) {
      currentState = newState;
    }
  }

  return request;
};

/**
 * Process a single argument and return new state if needed
 * State machine: flags set states, values are processed based on current state
 */
const processArgument = (arg, currentState, request) => {
  // Handle flag arguments first (they set states)
  const flagState = handleFlag(arg, request);
  if (flagState) {
    return flagState;
  }

  // Handle values based on current state (e.g., -H "value" where currentState is 'header')
  if (arg && currentState) {
    handleValue(arg, currentState, request);
    return null;
  }

  // Handle URL detection (only when no current state to avoid conflicts)
  if (!currentState && isURLOrFragment(arg)) {
    setURL(request, arg);
    return null;
  }

  return null;
};

/**
 * Flag definitions - maps flag names to their states and actions
 * State-returning flags expect a value, immediate action flags don't
 */
const FLAG_CATEGORIES = {
  // State-returning flags (expect a value after the flag)
  'user-agent': ['-A', '--user-agent'],
  'header': ['-H', '--header'],
  'data': ['-d', '--data', '--data-ascii', '--data-urlencode'],
  'json': ['--json'],
  'user': ['-u', '--user'],
  'method': ['-X', '--request'],
  'cookie': ['-b', '--cookie'],
  'form': ['-F', '--form'],
  // Special data flags with properties
  'data-raw': ['--data-raw'],
  'data-binary': ['--data-binary'],

  // Immediate action flags (no value expected)
  'head': ['-I', '--head'],
  'compressed': ['--compressed'],
  'insecure': ['-k', '--insecure'],
  // Query flags (convert data to query parameters).
  // Although this is an immediate action flag, the data to query string is processed later at post build request processing
  // Because of the unknown order of flags, we need to process the data to query string at the end
  'query': ['-G', '--get']
};

/**
 * Handle flag arguments and return new state
 * Determines if flag expects a value or performs immediate action
 */
const handleFlag = (arg, request) => {
  // Find which category this flag belongs to
  for (const [category, flags] of Object.entries(FLAG_CATEGORIES)) {
    if (flags.includes(arg)) {
      return handleFlagCategory(category, arg, request);
    }
  }

  return null;
};

/**
 * Handle flag based on its category
 * Returns state name for flags that expect values, null for immediate actions
 */
const handleFlagCategory = (category, arg, request) => {
  switch (category) {
    // State-returning flags (return category name to expect value)
    case 'user-agent':
    case 'header':
    case 'data':
    case 'json':
    case 'user':
    case 'method':
    case 'cookie':
    case 'form':
      return category;

    // Special data flags (set properties and return 'data' state)
    case 'data-raw':
      request.isDataRaw = true;
      return 'data';

    case 'data-binary':
      request.isDataBinary = true;
      return 'data';

    // Immediate action flags (perform action and return null)
    case 'head':
      request.method = 'HEAD';
      return null;

    case 'compressed':
      request.headers['Accept-Encoding'] = request.headers['Accept-Encoding'] || 'deflate, gzip';
      return null;

    case 'insecure':
      request.insecure = true;
      return null;

    case 'query':
      // set temporary property isQuery to true to indicate that the data should be converted to query string
      // this is processed later at post build request processing
      request.isQuery = true;
      return null;

    default:
      return null;
  }
};

/**
 * Handle values based on the current parsing state
 * Maps state names to their value processing functions
 */
const handleValue = (value, state, request) => {
  const valueHandlers = {
    'header': () => setHeader(request, value),
    'user-agent': () => setUserAgent(request, value),
    'data': () => setData(request, value),
    'json': () => setJsonData(request, value),
    'form': () => setFormData(request, value),
    'user': () => setAuth(request, value),
    'method': () => setMethod(request, value),
    'cookie': () => setCookie(request, value)
  };

  const handler = valueHandlers[state];
  if (handler) {
    handler();
  }
};

/**
 * Set header from value
 */
const setHeader = (request, value) => {
  const [headerName, headerValue] = value.split(/: (.+)/);
  request.headers[headerName] = headerValue;
};

/**
 * Set user agent
 */
const setUserAgent = (request, value) => {
  request.headers['User-Agent'] = value;
};

/**
 * Set data (handles multiple -d flags by concatenating with &)
 */
const setData = (request, value) => {
  request.data = request.data ? request.data + '&' + value : value;
};

/**
 * Set JSON data
 * JSON flag automatically sets Content-Type and converts GET/HEAD to POST
 */
const setJsonData = (request, value) => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    request.method = 'POST';
  }
  request.headers['Content-Type'] = 'application/json';
  // JSON data replaces existing data (don't append with &)
  request.data = value;
};

/**
 * Set form data
 * Form data always sets method to POST and creates multipart uploads
 */
const setFormData = (request, value) => {
  const formArray = Array.isArray(value) ? value : [value];
  const multipartUploads = [];

  formArray.forEach((field) => {
    const upload = parseFormField(field);
    if (upload) {
      multipartUploads.push(upload);
    }
  });

  request.multipartUploads = request.multipartUploads || [];
  request.multipartUploads.push(...multipartUploads);
  request.method = 'POST';
};

/**
 * Parse a single form field
 * Handles text fields, quoted values, and file uploads (@path)
 */
const parseFormField = (field) => {
  const match = field.match(/^([^=]+)=(?:@?"([^"]*)"|@([^@]*)|([^@]*))?$/);

  if (!match) return null;

  const fieldName = match[1];
  const fieldValue = match[2] || match[3] || match[4] || '';
  const isFile = field.includes('@');

  return {
    name: fieldName,
    value: fieldValue,
    type: isFile ? 'file' : 'text',
    enabled: true
  };
};

/**
 * Set authentication
 */
const setAuth = (request, value) => {
  if (typeof value !== 'string') {
    return;
  }

  const [username, password] = value.split(':');
  request.auth = {
    mode: 'basic',
    basic: {
      username: username || '',
      password: password || ''
    }
  };
};

/**
 * Set method
 */
const setMethod = (request, value) => {
  request.method = value.toUpperCase();
};

/**
 * Set cookie
 */
const setCookie = (request, value) => {
  if (typeof value !== 'string') {
    return;
  }

  const parsedCookies = cookie.parse(value);
  request.cookies = parsedCookies;
  request.cookieString = value;
  request.headers['Cookie'] = value;
};

/**
 * Check if argument is a URL or URL fragment
 */
const isURLOrFragment = (arg) => {
  return isURL(arg) || isURLFragment(arg);
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
 * Check if argument looks like a URL fragment
 * Handles shell-quote operator objects and query parameter patterns
 */
const isURLFragment = (arg) => {
  if (arg && typeof arg === 'object' && arg.op === 'glob') {
    return !!URL.parse(arg.pattern || '').host;
  }
  if (arg && typeof arg === 'object' && arg.op === '&') {
    return true;
  }
  if (typeof arg === 'string') {
    return /^[^=]+=[^&]*$/.test(arg);
  }
  return false;
};

/**
 * Set URL and related properties
 * Handles URL concatenation for shell-quote fragments
 */
const setURL = (request, url) => {
  const urlString = getUrlString(url);
  if (!urlString) return;

  request.url = request.url ? request.url + urlString : urlString;
  updateUrlWithoutQuery(request);
};

/**
 * Convert URL fragment to string
 * Handles shell-quote operator objects
 */
const getUrlString = (url) => {
  if (typeof url === 'string') return url;
  if (url?.op === 'glob') return url.pattern;
  if (url?.op === '&') return '&';
  return null;
};

/**
 * Update urlWithoutQuery property
 * Removes query parameters while preserving URL structure
 */
const updateUrlWithoutQuery = (request) => {
  if (!request.url) return;

  // Simple approach: split on '?' and take the first part
  request.urlWithoutQuery = request.url.split('?')[0];
};

/**
 * Clean up curl command
 * Handles escape sequences, line continuations, and method concatenation
 */
const cleanCurlCommand = (curlCommand) => {
  // Handle escape sequences
  curlCommand = curlCommand.replace(/\$('.*')/g, (match, group) => group);

  // Remove newlines and line continuations
  curlCommand = curlCommand.replace(/\\\r|\\\n/g, '');

  // Remove extra whitespace
  curlCommand = curlCommand.replace(/\s+/g, ' ');

  // Convert escaped single quotes
  curlCommand = curlCommand.replace(/\\'(?!')/g, "'\\''");

  // Fix concatenated HTTP methods
  curlCommand = fixConcatenatedMethods(curlCommand);

  return curlCommand.trim();
};

/**
 * Fix concatenated HTTP methods
 * Eg: Converts -XPOST to -X POST for proper parsing
 */
const fixConcatenatedMethods = (command) => {
  const methodFixes = [
    { from: / -XPOST/, to: ' -X POST' },
    { from: / -XGET/, to: ' -X GET' },
    { from: / -XPUT/, to: ' -X PUT' },
    { from: / -XPATCH/, to: ' -X PATCH' },
    { from: / -XDELETE/, to: ' -X DELETE' },
    { from: / -XOPTIONS/, to: ' -X OPTIONS' },
    { from: / -XHEAD/, to: ' -X HEAD' },
    { from: / -Xnull/, to: ' ' }
  ];

  methodFixes.forEach(({ from, to }) => {
    command = command.replace(from, to);
  });

  return command;
};

/**
 * Convert data to query string
 * Used when -G or --get flag is present to move data from body to URL
 */
const convertDataToQueryString = (request) => {
  let url = request.url;

  if (url.indexOf('?') < 0) {
    url += '?';
  } else if (!url.endsWith('&')) {
    url += '&';
  }

  // append data to url as query string
  url += request.data;

  const parsedUrl = URL.parse(url);

  const query = querystring.parse(parsedUrl.query, { sort: false });
  for (const param in query) {
    if (query[param] === null) {
      query[param] = '';
    }
  }

  request.url = URL.format(parsedUrl);
  request.query = query;

  return request;
};

/**
 * Post-build processing of request
 * Handles method conversion and query parameter processing
 */
const postBuildProcessRequest = (request) => {
  if (request.isQuery && request.data) {
    request = convertDataToQueryString(request);
    // remove data and isQuery from request as they are no longer needed
    delete request.data;
    delete request.isQuery;

  } else if (request.data) {
    // if data is present, set method to POST unless the method is explicitly set
    if (!request.method || request.method === 'HEAD') {
      request.method = 'POST';
    }
  }

  // if method is not set, set it to GET
  if (!request.method) {
    request.method = 'GET';
  }

  return request;
};

/**
 * Clean up the final request object (bruno specific)
 */
const normalizeRequest = (request) => {
  request.method = request.method.toLowerCase();

  if (isEmpty(request.headers)) {
    delete request.headers;
  }

  return request;
};

export default parseCurlCommand;
