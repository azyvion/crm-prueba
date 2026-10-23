-- ═══════════════════════════════════════════════════════════════════════
-- AZYVION CRM · Red-team Lote 7: un atacante autenticado (ADMIN de otra empresa) intenta
-- entrar a org_azyvion_001; un agente intenta escalar; anon intenta todo. Datos sintéticos;
-- SIEMPRE termina en RAISE EXCEPTION (todo se revierte). Resultado "RT_RESULTS: PASS=n FAIL=m".
-- Cada caso PASA si el ataque es BLOQUEADO.
-- ═══════════════════════════════════════════════════════════════════════
DO $s$
DECLARE
  res text := ''; pass int := 0; fail int := 0; ok boolean; n int; v numeric; t text; r jsonb;
  vic   text := 'org_azyvion_001';                               -- víctima
  vadm  text := 'c4477277-66a8-4a3f-8379-38b3b72eafed';          -- admin víctima (Hector)
  vagt  text := '9ed2cc01-79ce-46ed-88c2-000640635e6c';          -- agente víctima
  vuser text := 'test_agente_azyvion';
  atk   text := '9aa7c0b8-8fc1-4709-b133-3e2f73190b03';          -- ATACANTE: admin de otra empresa
  atkorg text := 'empresa-de-prueba-muxg48sm';
  vtarea uuid := gen_random_uuid(); vplant uuid; vpend uuid; vcli uuid := gen_random_uuid();
  claim constant text := '{"role":"authenticated"}';
BEGIN
  -- ── Sembrar datos de la víctima (como su admin) ───────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub',vadm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public."ActividadesCRM"(id,tipo,"refId",categoria,titulo,fecha,"fechaSeguimiento",prioridad,usuario,organization_id)
    VALUES (vtarea,'General',NULL,'Tarea','RT secreta víctima',current_date,current_date,'Alta',vuser,vic);
  INSERT INTO public.crm_plantillas(nombre,canal,cuerpo,creado_por) VALUES ('RT plantilla víctima','WhatsApp','secreto {nombre}','Hector') RETURNING id INTO vplant;
  INSERT INTO public.pos_ventas_pendientes(nota,datos) VALUES ('RT mesa víctima','{"items":[{"id":"x","cantidad":1}]}') RETURNING id INTO vpend;
  INSERT INTO public."Clientes"(id,nombre,telefono,organization_id) VALUES (vcli,'RT Cliente Víctima','5555-7777',vic);
  PERFORM public.crm_meta_guardar(jsonb_build_object('usuario',vuser,'meta_ventas',5000));
  RESET ROLE;

  -- ══════════════ ATACANTE = admin de empresa-de-prueba ══════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub',atk,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- R01 listar tareas no revela las de la víctima
  r := public.crm_tareas(NULL,NULL,false,true);
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'filas') x WHERE x->>'id'=vtarea::text;
  IF n=0 THEN pass:=pass+1; res:=res||'R01 PASS | '; ELSE fail:=fail+1; res:=res||'R01 FAIL ve tarea víctima | '; END IF;

  -- R02 no lee plantillas de la víctima
  SELECT count(*) INTO n FROM public.crm_plantillas WHERE id=vplant;
  IF n=0 THEN pass:=pass+1; res:=res||'R02 PASS | '; ELSE fail:=fail+1; res:=res||'R02 FAIL lee plantilla víctima | '; END IF;

  -- R03 no puede insertar una plantilla EN la empresa víctima
  BEGIN INSERT INTO public.crm_plantillas(organization_id,nombre,canal,cuerpo) VALUES (vic,'RT intrusa','WhatsApp','x'); ok:=false;
  EXCEPTION WHEN insufficient_privilege THEN ok:=true; WHEN others THEN ok:=true; END;
  IF ok THEN pass:=pass+1; res:=res||'R03 PASS | '; ELSE fail:=fail+1; res:=res||'R03 FAIL insertó plantilla en víctima | '; END IF;

  -- R04 no lee ventas pendientes de la víctima
  SELECT count(*) INTO n FROM public.pos_ventas_pendientes WHERE id=vpend;
  IF n=0 THEN pass:=pass+1; res:=res||'R04 PASS | '; ELSE fail:=fail+1; res:=res||'R04 FAIL lee pendiente víctima | '; END IF;

  -- R05 no puede borrar la pendiente de la víctima
  DELETE FROM public.pos_ventas_pendientes WHERE id=vpend; GET DIAGNOSTICS n=ROW_COUNT;
  IF n=0 THEN pass:=pass+1; res:=res||'R05 PASS | '; ELSE fail:=fail+1; res:=res||'R05 FAIL borró pendiente víctima | '; END IF;

  -- R06 no puede leer la tabla de auditoría directamente
  BEGIN SELECT count(*) INTO n FROM public.crm_auditoria; ok:=false; EXCEPTION WHEN insufficient_privilege THEN ok:=true; END;
  IF ok THEN pass:=pass+1; res:=res||'R06 PASS | '; ELSE fail:=fail+1; res:=res||'R06 FAIL lee crm_auditoria directo | '; END IF;

  -- R07 crm_listar_auditoria no revela filas de la víctima (incluso con comodín ILIKE)
  r := public.crm_listar_auditoria(current_date-1,current_date,NULL,'%');
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'filas') x WHERE x->>'registro_id'=vcli::text OR x->>'registro_id'=vtarea::text;
  IF n=0 THEN pass:=pass+1; res:=res||'R07 PASS | '; ELSE fail:=fail+1; res:=res||'R07 FAIL auditoría cruzada n='||n||' | '; END IF;

  -- R08 no puede asignar meta a un usuario de la víctima
  BEGIN PERFORM public.crm_meta_guardar(jsonb_build_object('usuario',vuser,'meta_ventas',1)); ok:=false;
  EXCEPTION WHEN others THEN ok := SQLSTATE='22023'; END;
  IF ok THEN pass:=pass+1; res:=res||'R08 PASS | '; ELSE fail:=fail+1; res:=res||'R08 FAIL asignó meta a víctima | '; END IF;

  -- R09 progreso de metas no revela usuarios de la víctima
  r := public.crm_metas_progreso(NULL);
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'filas') x WHERE x->>'usuario' IN (vuser,'Hector Reyes','Alex','Luis');
  IF n=0 THEN pass:=pass+1; res:=res||'R09 PASS | '; ELSE fail:=fail+1; res:=res||'R09 FAIL metas revelan víctima n='||n||' | '; END IF;

  -- R10 importar: aunque intente, no puede crear clientes en la empresa víctima (INVOKER+RLS)
  PERFORM public.crm_importar_clientes(jsonb_build_array(jsonb_build_object('nombre','RT inyectado','nit','RT-999')), false, false);
  SELECT count(*) INTO n FROM public."Clientes" WHERE organization_id=vic AND nombre='RT inyectado';
  IF n=0 THEN pass:=pass+1; res:=res||'R10 PASS | '; ELSE fail:=fail+1; res:=res||'R10 FAIL importó cliente en víctima | '; END IF;

  -- R13 suplantación: fija usuario y org de la víctima al guardar su propia pendiente
  INSERT INTO public.pos_ventas_pendientes(usuario,organization_id,nota,datos)
    VALUES ('Hector Reyes',vic,'RT suplantada','{"items":[]}') RETURNING id INTO vpend;
  RESET ROLE;
  SELECT organization_id||'/'||usuario INTO t FROM public.pos_ventas_pendientes WHERE id=vpend;
  IF t = atkorg||'/usuario-de-prueba-xg48sm' OR split_part(t,'/',1)=atkorg THEN pass:=pass+1; res:=res||'R13 PASS | ';
  ELSE fail:=fail+1; res:=res||'R13 FAIL suplantó autor/org: '||COALESCE(t,'∅')||' | '; END IF;

  -- R15/R16 IDOR en credenciales FEL de la víctima
  PERFORM set_config('request.jwt.claims', json_build_object('sub',atk,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.get_fel_credentials_status(vic);
  IF (r->>'authorized')::boolean IS NOT TRUE THEN pass:=pass+1; res:=res||'R15 PASS | '; ELSE fail:=fail+1; res:=res||'R15 FAIL leyó estado FEL víctima | '; END IF;
  BEGIN PERFORM public.set_fel_credentials(vic,'hacker','KEY-ROBADA',false); ok:=false; EXCEPTION WHEN others THEN ok:=SQLSTATE='42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'R16 PASS | '; ELSE fail:=fail+1; res:=res||'R16 FAIL escribió FEL víctima | '; END IF;
  RESET ROLE;

  -- ══════════════ ESCALADA: agente de la víctima ══════════════
  PERFORM set_config('request.jwt.claims', json_build_object('sub',vagt,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- R11 agente no importa clientes ni productos
  BEGIN PERFORM public.crm_importar_clientes('[{"nombre":"x"}]'::jsonb,false,true); ok:=false; EXCEPTION WHEN others THEN ok:=SQLSTATE='42501'; END;
  BEGIN PERFORM public.crm_importar_productos('[{"producto":"x"}]'::jsonb,false,true); ok:=ok AND false; EXCEPTION WHEN others THEN ok:=ok AND SQLSTATE='42501'; END;
  -- agente no asigna metas ni ve auditoría
  BEGIN PERFORM public.crm_meta_guardar(jsonb_build_object('usuario',vuser,'meta_ventas',1)); ok:=ok AND false; EXCEPTION WHEN others THEN ok:=ok AND SQLSTATE='42501'; END;
  BEGIN PERFORM public.crm_listar_auditoria(current_date,current_date); ok:=ok AND false; EXCEPTION WHEN others THEN ok:=ok AND SQLSTATE='42501'; END;
  IF ok THEN pass:=pass+1; res:=res||'R11 PASS | '; ELSE fail:=fail+1; res:=res||'R11 FAIL agente escaló | '; END IF;
  -- R12 agente no puede alterar ni borrar la auditoría (inmutable)
  INSERT INTO public."Clientes"(id,nombre,organization_id) VALUES (gen_random_uuid(),'RT para auditar',vic);  -- genera 1 fila de auditoría
  RESET ROLE;
  BEGIN UPDATE public.crm_auditoria SET usuario='hacker' WHERE organization_id=vic; ok:=false; EXCEPTION WHEN others THEN ok:=true; END;
  BEGIN DELETE FROM public.crm_auditoria WHERE organization_id=vic; ok:=ok AND false; EXCEPTION WHEN others THEN ok:=ok AND true; END;
  IF ok THEN pass:=pass+1; res:=res||'R12 PASS | '; ELSE fail:=fail+1; res:=res||'R12 FAIL auditoría mutable | '; END IF;

  -- R17 la auditoría nunca guarda la contraseña
  PERFORM set_config('request.jwt.claims', json_build_object('sub',vadm,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN UPDATE public."Usuarios" SET contrasena='RT-no-debe-verse' WHERE auth_uid::text=vagt; EXCEPTION WHEN others THEN NULL; END;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.crm_auditoria WHERE cambios::text LIKE '%RT-no-debe-verse%';
  IF n=0 THEN pass:=pass+1; res:=res||'R17 PASS | '; ELSE fail:=fail+1; res:=res||'R17 FAIL auditoría filtró contraseña | '; END IF;

  -- ══════════════ ANON (sin sesión) ══════════════
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  ok := true;
  BEGIN PERFORM public.crm_tareas(); ok:=ok AND false; EXCEPTION WHEN others THEN ok:=ok AND SQLSTATE='42501'; END;
  BEGIN SELECT count(*) INTO n FROM public.crm_plantillas; ok:=ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok:=ok AND true; END;
  BEGIN SELECT count(*) INTO n FROM public.pos_ventas_pendientes; ok:=ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok:=ok AND true; END;
  BEGIN SELECT count(*) INTO n FROM public.crm_metas; ok:=ok AND false; EXCEPTION WHEN insufficient_privilege THEN ok:=ok AND true; END;
  BEGIN PERFORM public.crm_importar_clientes('[{"nombre":"x"}]'::jsonb,false,false); ok:=ok AND false; EXCEPTION WHEN others THEN ok:=ok AND SQLSTATE='42501'; END;
  BEGIN PERFORM public.crm_metas_progreso(NULL); ok:=ok AND false; EXCEPTION WHEN others THEN ok:=ok AND SQLSTATE='42501'; END;
  RESET ROLE;
  IF ok THEN pass:=pass+1; res:=res||'R14 PASS | '; ELSE fail:=fail+1; res:=res||'R14 FAIL anon accedió | '; END IF;

  RAISE EXCEPTION 'RT_RESULTS: PASS=% FAIL=% | %', pass, fail, res;
END $s$;
