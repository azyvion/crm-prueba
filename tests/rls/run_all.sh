#!/usr/bin/env bash
# Ejecuta todas las suites SQL. Cada bloque termina en RAISE EXCEPTION con
# "<SUITE>_RESULTS: PASS=n FAIL=m" (todo se revierte); este script lo interpreta.
# Uso: SUPABASE_DB_URL=postgres://... bash tests/rls/run_all.sh
set -uo pipefail
: "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL}"
dir="$(cd "$(dirname "$0")" && pwd)"
total_fail=0
for f in "$dir"/rls_regression.sql "$dir"/rls_lote2_org_fel.sql "$dir"/cotizaciones_integridad.sql "$dir"/pos_stock.sql "$dir"/pos_ventas.sql "$dir"/pos_config.sql "$dir"/negocio.sql; do
  # psql ejecuta cada DO por separado; capturamos todos los mensajes *_RESULTS
  out="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=0 -X -q -f "$f" 2>&1)"
  results="$(grep -oE '[A-Z]+_RESULTS: PASS=[0-9]+ FAIL=[0-9]+[^\n]*' <<<"$out")"
  if [[ -z "$results" ]]; then
    echo "✖ $(basename "$f"): no produjo resultados"; echo "$out" | head -20; total_fail=$((total_fail+1)); continue
  fi
  while read -r line; do
    echo "$(basename "$f"): $line"
    fails="$(sed -E 's/.*FAIL=([0-9]+).*/\1/' <<<"$line")"
    total_fail=$((total_fail+fails))
  done <<<"$results"
done
if (( total_fail > 0 )); then echo "✖ $total_fail prueba(s) SQL fallaron"; exit 1; fi
echo "✔ Todas las pruebas SQL pasaron"
