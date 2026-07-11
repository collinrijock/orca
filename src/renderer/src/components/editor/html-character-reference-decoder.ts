export type HtmlAttributeQuote = '"' | "'" | null

export function decodeHtmlTextCharacterReferences(value: string): string {
  const template = document.createElement('template')
  template.innerHTML = value
  return template.content.textContent ?? ''
}

export function decodeHtmlAttributeCharacterReferences(
  value: string,
  quote: HtmlAttributeQuote
): string {
  const template = document.createElement('template')
  const delimiter = quote ?? ''
  template.innerHTML = `<span data-orca-value=${delimiter}${value}${delimiter}></span>`
  const element = template.content.firstElementChild
  return element?.getAttribute('data-orca-value') ?? ''
}
