import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type QueryParams = Record<
  string,
  string | number | boolean | (string | number | boolean)[] | null | undefined
>;

export interface HttpRequestOptions {
  params?: QueryParams;
  context?: HttpContext;
}

/**
 * Wrapper fino sobre HttpClient. NO gestiona la autenticación: el token viaja en una
 * cookie HttpOnly y el `authInterceptor` añade `withCredentials` a las llamadas al
 * backend de forma centralizada (ver core/auth.interceptor.ts).
 */
@Injectable({ providedIn: 'root' })
export class RequestService {
  private readonly http: HttpClient = inject(HttpClient);
  private readonly baseUrl: string = environment.backendUrl;

  get<T>(endpoint: string, options?: HttpRequestOptions): Promise<T> {
    return firstValueFrom(this.http.get<T>(this.url(endpoint), this.toHttpOptions(options)));
  }

  post<T, B = unknown>(endpoint: string, body?: B, options?: HttpRequestOptions): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.url(endpoint), body, this.toHttpOptions(options)));
  }

  put<T, B = unknown>(endpoint: string, body?: B, options?: HttpRequestOptions): Promise<T> {
    return firstValueFrom(this.http.put<T>(this.url(endpoint), body, this.toHttpOptions(options)));
  }

  patch<T, B = unknown>(endpoint: string, body?: B, options?: HttpRequestOptions): Promise<T> {
    return firstValueFrom(this.http.patch<T>(this.url(endpoint), body, this.toHttpOptions(options)));
  }

  delete<T>(endpoint: string, options?: HttpRequestOptions): Promise<T> {
    return firstValueFrom(this.http.delete<T>(this.url(endpoint), this.toHttpOptions(options)));
  }

  /** Descarga binaria (adjuntos). */
  download(endpoint: string, options?: HttpRequestOptions): Promise<Blob> {
    return firstValueFrom(
      this.http.get(this.url(endpoint), {
        params: this.toParams(options?.params),
        context: options?.context,
        responseType: 'blob',
      }),
    );
  }

  private url(endpoint: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
  }

  private toHttpOptions(options?: HttpRequestOptions): { params?: HttpParams; context?: HttpContext } {
    return {
      params: this.toParams(options?.params),
      context: options?.context,
    };
  }

  private toParams(query?: QueryParams): HttpParams | undefined {
    if (!query) return undefined;

    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry !== undefined && entry !== null) params = params.append(key, String(entry));
        });
      } else {
        params = params.set(key, String(value));
      }
    }

    return params;
  }
}
