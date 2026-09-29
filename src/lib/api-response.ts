// Access redirects and gateway HTML must never be parsed as editor state.
export function requireApiResponse(response: Response) {
  if(response.redirected||response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`后台返回了登录页或服务错误页（HTTP ${response.status}）。本页修改仍保留，请勿刷新；${response.status>=500?'后台服务异常，请稍后重试；持续失败需检查服务器日志。':'请在新窗口确认后台登录后，回到本页重试。'}`);
  }
  return response;
}
