    fn establish_connection_internal<'a>(
        app: AppHandle,
        cfg: &'a SshConfig,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<SshHandle, String>> + Send + 'a>> {
        Box::pin(async move {
            let state = app.state::<AppState>();
            if cfg.reuse_session && !cfg.profile_id.is_empty() {
                if let Some(h) = state.get_pooled_ssh(&cfg.profile_id) {
                    return Ok(h);
                }
            }

            let handler = ClientHandler { skip_banner: cfg.skip_banner,
                app: app.clone(),
                host: cfg.host.clone(),
                port: cfg.port,
            };

            let mut config = client::Config::default();
            if let Some(ms) = cfg.keep_alive_interval {
                if ms > 0 {
                    config.keepalive_interval = Some(Duration::from_millis(ms));
                }
            }
            if let Some(n) = cfg.keep_alive_max {
                config.keepalive_max = n;
            }
            if let Some(c) = &cfg.ciphers {
                let mut pref = Preferred::DEFAULT.clone();
                let ciphers = parse_names::<cipher::Name>(&c.ciphers);
                if !ciphers.is_empty() {
                    pref.cipher = Cow::Owned(ciphers);
                }
                let kexs = parse_names::<kex::Name>(&c.kex);
                if !kexs.is_empty() {
                    pref.kex = Cow::Owned(kexs);
                }
                let macs = parse_names::<mac::Name>(&c.hmac);
                if !macs.is_empty() {
                    pref.mac = Cow::Owned(macs);
                }
                let comps = parse_names::<compression::Name>(&c.compression);
                if !comps.is_empty() {
                    pref.compression = Cow::Owned(comps);
                }
                let keys: Vec<Algorithm> =
                    c.host_key.iter().filter_map(|s| s.parse().ok()).collect();
                if !keys.is_empty() {
                    pref.key = Cow::Owned(keys);
                }
                config.preferred = pref;
            }
            let config = Arc::new(config);

            let mut handle = if let Some(jh) = &cfg.jump_host_config {
                let jh_handle = Self::establish_connection_internal(app.clone(), jh).await?;
                let mut jh_channel = jh_handle.lock().await.channel_open_direct_tcpip(cfg.host.clone(), cfg.port as u32, "localhost", 0)
                    .await
                    .map_err(|e| format!("jump host channel open failed: {e}"))?;
                
                let stream = jh_channel.into_stream();
                let connect_fut = client::connect_stream(config, stream, handler);
                match cfg.ready_timeout {
                    Some(ms) if ms > 0 => tokio::time::timeout(Duration::from_millis(ms), connect_fut)
                        .await
                        .map_err(|_| "connection timed out".to_string())?
                        .map_err(|e| format!("connect failed: {e}"))?,
                    _ => connect_fut
                        .await
                        .map_err(|e| format!("connect failed: {e}"))?,
                }
            } else {
                let connect_fut = client::connect(config, (cfg.host.clone(), cfg.port), handler);
                match cfg.ready_timeout {
                    Some(ms) if ms > 0 => tokio::time::timeout(Duration::from_millis(ms), connect_fut)
                        .await
                        .map_err(|_| "connection timed out".to_string())?
                        .map_err(|e| format!("connect failed: {e}"))?,
                    _ => connect_fut
                        .await
                        .map_err(|e| format!("connect failed: {e}"))?,
                }
            };

            let auth = match &cfg.auth {
                SshAuth::Password { password } => handle
                    .authenticate_password(cfg.username.clone(), password.clone())
                    .await
                    .map_err(|e| format!("auth error: {e}"))?,
                SshAuth::Key { path, passphrase } => {
                    let key = load_secret_key(path, passphrase.as_deref())
                        .map_err(|e| format!("load key failed: {e}"))?;
                    handle
                        .authenticate_publickey(
                            cfg.username.clone(),
                            PrivateKeyWithHashAlg::new(Arc::new(key), None),
                        )
                        .await
                        .map_err(|e| format!("auth error: {e}"))?
                }
            };

            if !matches!(auth, AuthResult::Success) {
                return Err("authentication failed".to_string());
            }

            let handle = Arc::new(tokio::sync::Mutex::new(handle));
            if cfg.reuse_session && !cfg.profile_id.is_empty() {
                state.set_pooled_ssh(cfg.profile_id.clone(), handle.clone());
            }

            Ok(handle)
        })
    }

    async fn establish_connection(
        app: AppHandle,
        cfg: &SshConfig,
    ) -> Result<SshHandle, String> {
        Self::establish_connection_internal(app, cfg).await
    }

