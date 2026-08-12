/**
 * API única do novo Prioridades DSA.
 *
 * Regra de segurança:
 * - senha nunca é enviada por query string em GET;
 * - login e reautenticação usam POST;
 * - rotas autenticadas recebem token de sessão.
 */

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  const action = String(p.action || 'health').trim();

  try {
    if (action === 'health') {
      return outputJson_({
        ok: true,
        app: APP.NAME,
        version: APP.VERSION,
        db_version: APP.DB_VERSION,
        timestamp: new Date().toISOString()
      });
    }

    return outputJson_({
      ok: false,
      error: 'Use POST para rotas da aplicação.'
    });

  } catch (err) {
    return apiError_(err);
  }
}


function doPost(e) {
  try {
    const request = requestData_(e);
    const action = String(request.action || '').trim();

    if (!action) {
      return outputJson_({ok:false, error:'Ação não informada.'});
    }

    if (action === 'login') {
      return outputJson_(
        autenticar_(request.login || request.email, request.senha)
      );
    }

    const user = requireUser_(request.token);

    switch (action) {
      case 'session':
        return outputJson_({
          ok: true,
          user: publicUser_(user),
          modules: allowedModules_(user),
          session: {
            valid: true,
            expires_in: APP.SESSION_SECONDS
          }
        });

      case 'logout':
        revokeSessionToken_(request.token);
        return outputJson_({
          ok: true
        });

      case 'reauth':
        return outputJson_(
          reautenticarUsuario_(user, request.senha)
        );

      case 'scope':
        return outputJson_({
          ok: true,
          scope: territoryScope_(user)
        });

      case 'bootstrap':
        return outputJson_(
          bootstrap_(user, request)
        );

      case 'resolve_period': {
        const period = resolvePeriod_(request);
        return outputJson_({
          ok: true,
          data_inicio: period.data_inicio,
          data_fim: period.data_fim
        });
      }

      case 'dashboard':
        return outputJson_(
          dashboard_(user, request)
        );

      case 'list_results':
        return outputJson_(
          listResults_(user, request)
        );

      case 'save_result':
        return outputJson_(
          saveResult_(user, request)
        );

      case 'effective_goals': {
        requireModule_(user, APP.MODULE_KEYS.REQUIREMENTS);
        const context = normalizeContext_(user, request);
        return outputJson_({
          ok:true,
          context:{
            polo_id:context.polo_id,
            distrito_id:context.distrito_id,
            igreja_id:context.igreja_id,
            data_inicio:context.data_inicio,
            data_fim:context.data_fim
          },
          data:effectiveGoals_(user, context)
        });
      }

      case 'save_church_goal':
        return outputJson_(
          saveChurchGoal_(user, request)
        );

      case 'list_requirements':
        return outputJson_(
          listRequirements_(user, request)
        );

      case 'requirement_goal_view':
        return outputJson_(
          requirementGoalView_(user, request)
        );

      case 'save_requirement':
        return outputJson_(
          saveRequirement_(user, request)
        );

      case 'save_global_goal':
        return outputJson_(
          saveGlobalGoal_(user, request)
        );

      case 'reset_church_goal':
        return outputJson_(
          resetChurchGoal_(user, request)
        );

      case 'list_planner':
        return outputJson_(
          listPlanner_(user, request)
        );

      case 'planner_summary':
        return outputJson_(
          plannerSummary_(user, request)
        );

      case 'save_planner_task':
        return outputJson_(
          savePlannerTask_(user, request)
        );

      case 'delete_planner_task':
        return outputJson_(
          deletePlannerTask_(user, request)
        );

      case 'restore_planner_task':
        return outputJson_(
          restorePlannerTask_(user, request)
        );

      case 'timeline':
        return outputJson_(
          timeline_(user, request)
        );

      case 'get_my_church':
        return outputJson_(
          getMyChurch_(user, request)
        );

      case 'save_my_church':
        return outputJson_(
          saveMyChurch_(user, request)
        );

      case 'list_departments':
        return outputJson_(
          listDepartments_(user)
        );

      case 'save_church_department':
        return outputJson_(
          saveChurchDepartment_(user, request)
        );

      case 'save_church_departments_batch':
        return outputJson_(
          saveChurchDepartmentsBatch_(user, request)
        );

      case 'save_department':
        return outputJson_(
          saveDepartment_(user, request)
        );

      case 'list_reports':
        return outputJson_(
          listReports_(user, request)
        );

      case 'get_report':
        return outputJson_(
          getReport_(user, request)
        );

      case 'save_report':
        return outputJson_(
          saveReport_(user, request)
        );

      case 'archive_report':
        return outputJson_(
          archiveReport_(user, request)
        );

      case 'list_difficulties':
        requireModule_(user, APP.MODULE_KEYS.REPORTS);
        return outputJson_({
          ok:true,
          data:activeDifficulties_()
        });

      case 'save_difficulty':
        return outputJson_(
          saveDifficulty_(user, request)
        );

      case 'save_report_difficulties':
        return outputJson_(
          saveReportDifficulties_(user, request)
        );

      case 'whatsapp_summary':
        return outputJson_(
          buildWhatsAppSummary_(user, request)
        );

      case 'report_data_package':
        return outputJson_(
          reportDataPackage_(user, request)
        );

      case 'generate_ai_report':
        return outputJson_(
          generateAIReport_(user, request)
        );

      case 'list_fofa_items':
        return outputJson_(listFofaItems_(user, request));

      case 'list_fofa_evaluations':
        return outputJson_(listFofaEvaluations_(user, request));

      case 'start_fofa_evaluation':
        return outputJson_(startFofaEvaluation_(user, request));

      case 'get_fofa_evaluation':
        return outputJson_(getFofaEvaluation_(user, request));

      case 'save_fofa_response':
        return outputJson_(saveFofaResponse_(user, request));

      case 'conclude_fofa_evaluation':
        return outputJson_(concludeFofaEvaluation_(user, request));

      case 'fofa_history':
        return outputJson_(fofaHistory_(user, request));

      case 'ai_status': {
        requireModule_(
          user,
          APP.MODULE_KEYS.REPORTS
        );

        const props =
          PropertiesService.getScriptProperties();

        return outputJson_({
          ok:true,
          provider:'Gemini',
          api:'Interactions API',
          configured:!!String(
            props.getProperty('GEMINI_API_KEY') || ''
          ).trim(),
          model:String(
            props.getProperty('GEMINI_MODEL') ||
            GEMINI_REPORT.DEFAULT_MODEL
          ),
          max_output_tokens:Number(
            props.getProperty('GEMINI_MAX_OUTPUT_TOKENS') ||
            GEMINI_REPORT.DEFAULT_MAX_OUTPUT_TOKENS
          )
        });
      }

      case 'developer_bootstrap':
        return outputJson_(
          developerOptionsBootstrap_(user)
        );

      case 'list_users_admin':
        return outputJson_(
          listUsersAdmin_(user)
        );

      case 'get_user_admin':
        return outputJson_(
          getUserAdmin_(user, request)
        );

      case 'save_user_admin':
        return outputJson_(
          saveUserAdmin_(user, request)
        );

      case 'save_user_modules_admin':
        return outputJson_(
          saveUserModulesAdmin_(user, request)
        );

      case 'deactivate_user_admin':
        return outputJson_(
          deactivateUserAdmin_(user, request)
        );

      case 'reactivate_user_admin':
        return outputJson_(
          reactivateUserAdmin_(user, request)
        );

      case 'reset_user_password_admin':
        return outputJson_(
          resetUserPasswordAdmin_(user, request)
        );

      case 'save_user_photo_url_admin':
        return outputJson_(
          saveUserPhotoUrlAdmin_(user, request)
        );

      case 'user_photos_status_admin':
        return outputJson_(
          userPhotosStatusAdmin_(user)
        );

      case 'upload_user_photo_admin':
        return outputJson_(
          uploadUserPhotoAdmin_(user, request)
        );

      case 'remove_user_photo_admin':
        return outputJson_(
          removeUserPhotoAdmin_(user, request)
        );

      case 'audit_base':
        requireDeveloper_(user);
        return outputJson_({
          ok: true,
          audit: auditarBase_()
        });

      default:
        return outputJson_({
          ok: false,
          error: 'Ação não reconhecida: ' + action
        });
    }

  } catch (err) {
    return apiError_(err);
  }
}


function requestData_(e) {
  const params = Object.assign(
    {},
    e && e.parameter ? e.parameter : {}
  );

  const body = e && e.postData && e.postData.contents
    ? String(e.postData.contents)
    : '';

  if (!body) return params;

  const type = String(
    e && e.postData ? e.postData.type || '' : ''
  ).toLowerCase();

  if (type.indexOf('application/json') >= 0) {
    try {
      return Object.assign(params, JSON.parse(body));
    } catch (_err) {
      throw new Error('JSON inválido.');
    }
  }

  // application/x-www-form-urlencoded já está em e.parameter.
  return params;
}


function requireDeveloper_(user) {
  if (String(user.perfil || '') !== APP.ROLES.DEVELOPER) {
    throw new Error('Ação exclusiva do Desenvolvedor.');
  }

  return true;
}


function outputJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}


function apiError_(err) {
  console.error(err && err.stack ? err.stack : err);

  return outputJson_({
    ok: false,
    error: String(err && err.message ? err.message : err)
  });
}


/**
 * TESTE MANUAL — v1.11 R1
 *
 * Execute no editor do Apps Script após implantar a R1.
 * Não exige senha e não altera dados.
 *
 * Cria uma sessão temporária para o usuário Dev, valida em seguida
 * e revoga o token antes de retornar.
 */
function testarSessaoR1() {
  const user = userByLogin_('Dev');

  if (!user) {
    throw new Error('Usuário Dev não encontrado na aba USUARIOS.');
  }

  if (!bool_(user.ativo)) {
    throw new Error('Usuário Dev está inativo.');
  }

  const token = createSessionToken_(user);
  const resolved = sessionUser_(token);

  const result = {
    ok: !!resolved,
    usuario_id: resolved ? String(resolved.usuario_id || '') : '',
    login: resolved ? String(resolved.login || '') : '',
    perfil: resolved ? String(resolved.perfil || '') : '',
    token_formato: String(token || '').split('.')[0]
  };

  revokeSessionToken_(token);

  if (!result.ok) {
    throw new Error('Falha no teste interno de sessão R1.');
  }

  return result;
}
