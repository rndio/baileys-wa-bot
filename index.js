const {
    default: makeWASocket,
	MessageType, 
    MessageOptions, 
    Mimetype,
	DisconnectReason,
	BufferJSON,
    AnyMessageContent, 
	delay, 
	fetchLatestBaileysVersion, 
	isJidBroadcast, 
	makeCacheableSignalKeyStore, 
	makeInMemoryStore, 
	MessageRetryMap, 
	useMultiFileAuthState,
	msgRetryCounterMap
} = require("@adiwajshing/baileys");

const log = (pino = require("pino"));
const { session } = {"session": "baileys_auth_info"};
const { Boom } =require("@hapi/boom");
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require("express");
const fileUpload = require('express-fileupload');
const cors = require('cors');
const bodyParser = require("body-parser");
const app = require("express")()
// enable files upload
app.use(fileUpload({
    createParentPath: true
}));

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
  res.sendFile("./client/server.html", {
    root: __dirname,
  });
});

app.get("/", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});
//fungsi suara capital 
function capital(textSound){
    const arr = textSound.split(" ");
    for (var i = 0; i < arr.length; i++) {
        arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1);
    }
    const str = arr.join(" ");
    return str;
}
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let sock;
let qr;
let soket;

async function connectToWhatsApp() {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	let { version, isLatest } = await fetchLatestBaileysVersion();
    sock = makeWASocket({
        printQRInTerminal: true,
		auth: state,
		logger: log({ level: "silent" }),
		version,
		shouldIgnoreJid: jid => isJidBroadcast(jid),
    });
	store.bind(sock.ev);
	sock.multi = true
	sock.ev.on('connection.update', async (update) => {
    	//console.log(update);
		const { connection, lastDisconnect } = update;
		if(connection === 'close') {
            let reason = new Boom(lastDisconnect.error).output.statusCode;
			if (reason === DisconnectReason.badSession) {
				console.log(`Bad Session File, Please Delete ${session} and Scan Again`);
				sock.logout();
			} else if (reason === DisconnectReason.connectionClosed) {
				console.log("Connection closed, reconnecting....");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.connectionLost) {
				console.log("Connection Lost from Server, reconnecting...");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.connectionReplaced) {
				console.log("Connection Replaced, Another New Session Opened, Please Close Current Session First");
				sock.logout();
			} else if (reason === DisconnectReason.loggedOut) {
				console.log(`Device Logged Out, Please Delete ${session} and Scan Again.`);
				sock.logout();
			} else if (reason === DisconnectReason.restartRequired) {
				console.log("Restart Required, Restarting...");
				connectToWhatsApp();
			} else if (reason === DisconnectReason.timedOut) {
				console.log("Connection TimedOut, Reconnecting...");
				connectToWhatsApp();
			} else {
				sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
			}
        }else if(connection === 'open') {
			console.log('opened connection');
			let getGroups = await sock.groupFetchAllParticipating();
			let groups = Object.entries(getGroups).slice(0).map(entry => entry[1]);
			console.log(groups);
			return;
        } 
    });
	sock.ev.on("creds.update", saveCreds);
	sock.ev.on("messages.upsert", async ({ messages, type }) => {
        //console.log(messages);
        if(type === "notify"){
            if(!messages[0].key.fromMe) {
                //tentukan jenis pesan berbentuk text                
                const pesan = messages[0].message.conversation;
				
				//nowa dari pengirim pesan sebagai id
                const noWa = messages[0].key.remoteJid;

                await sock.readMessages([messages[0].key]);

                //kecilkan semua pesan yang masuk lowercase 
                const pesanMasuk = pesan.toLowerCase();
				
                if(!messages[0].key.fromMe && pesanMasuk === "ping"){
                    await sock.sendMessage(noWa, {text: "Pong"},{quoted: messages[0] });
                }else{
                    await sock.sendMessage(noWa, {text: "Saya adalah Bot!"},{quoted: messages[0] });
                }
			}		
		}		
    });
}

io.on("connection", async (socket) => {
    soket = socket;
    // console.log(sock)
    if (isConnected) {
        updateQR("connected");
    } else if (qr) {
        updateQR("qr");   
    }
});

// functions
const isConnected = () => {
    return (sock.user);
};

const updateQR = (data) => {
    switch (data) {
        case "qr":
            qrcode.toDataURL(qr, (err, url) => {
                soket?.emit("qr", url);
                soket?.emit("log", "QR Code received, please scan!");
            });
            break;
        case "connected":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "WhatsApp terhubung!");
            break;
        case "qrscanned":
            soket?.emit("qrstatus", "./assets/check.svg");
            soket?.emit("log", "QR Code Telah discan!");
            break;
        case "loading":
            soket?.emit("qrstatus", "./assets/loader.gif");
            soket?.emit("log", "Registering QR Code , please wait!");
            break;
        default:
            break;
    }
};

// send text message to wa user
app.post("/send-message", async (req, res) =>{
    //console.log(req);
    const pesankirim = req.body.message;
    const number = req.body.number;
    const fileDikirim = req.files;
    
	let numberWA;
    try {
        if(!req.files) 
        {
            if(!number) {
                 res.status(500).json({
                    status: false,
                    response: 'Nomor WA belum tidak disertakan!'
                });
            }
            else
            {
                numberWA = '62' + number.substring(1) + "@s.whatsapp.net"; 
                console.log(await sock.onWhatsApp(numberWA));
                if (isConnected) {
                    const exists = await sock.onWhatsApp(numberWA);
                    if (exists?.jid || (exists && exists[0]?.jid)) {
                        sock.sendMessage(exists.jid || exists[0].jid, { text: pesankirim })
                        .then((result) => {
                            res.status(200).json({
                                status: true,
                                response: result,
                            });
                        })
                        .catch((err) => {
                            res.status(500).json({
                                status: false,
                                response: err,
                            });
                        });
                    } else {
                        res.status(500).json({
                            status: false,
                            response: `Nomor ${number} tidak terdaftar.`,
                        });
                    }
                } else {
                    res.status(500).json({
                        status: false,
                        response: `WhatsApp belum terhubung.`,
                    });
                }    
            }
        }
        else
        {
            //console.log('Kirim document');
            if(!number) {
                 res.status(500).json({
                    status: false,
                    response: 'Nomor WA belum tidak disertakan!'
                });
            }
            else
            {
                
                numberWA = '62' + number.substring(1) + "@s.whatsapp.net"; 
                //console.log('Kirim document ke'+ numberWA);
                let filesimpan = req.files.file_dikirim;
                var file_ubah_nama = new Date().getTime() +'_'+filesimpan.name;
                //pindahkan file ke dalam upload directory
                filesimpan.mv('./uploads/' + file_ubah_nama);
                let fileDikirim_Mime = filesimpan.mimetype;
                //console.log('Simpan document '+fileDikirim_Mime);

                //console.log(await sock.onWhatsApp(numberWA));

                if (isConnected) {
                    const exists = await sock.onWhatsApp(numberWA);

                    if (exists?.jid || (exists && exists[0]?.jid)) {
                        
                        let namafiledikirim = './uploads/' + file_ubah_nama;
                        let extensionName = path.extname(namafiledikirim); 
                        //console.log(extensionName);
                        if( extensionName === '.jpeg' || extensionName === '.jpg' || extensionName === '.png' || extensionName === '.gif' ) {
                             await sock.sendMessage(exists.jid || exists[0].jid, { 
                                image: {
                                    url: namafiledikirim
                                },
                                caption:pesankirim
                            }).then((result) => {
                                if (fs.existsSync(namafiledikirim)) {
                                    fs.unlink(namafiledikirim, (err) => {
                                        if (err && err.code == "ENOENT") {
                                            // file doens't exist
                                            console.info("File doesn't exist, won't remove it.");
                                        } else if (err) {
                                            console.error("Error occurred while trying to remove file.");
                                        }
                                        //console.log('File deleted!');
                                    });
                                }
                                res.send({
                                    status: true,
                                    message: 'Success',
                                    data: {
                                        name: filesimpan.name,
                                        mimetype: filesimpan.mimetype,
                                        size: filesimpan.size
                                    }
                                });
                            }).catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log('pesan gagal terkirim');
                            });
                        }else if(extensionName === '.mp3' || extensionName === '.ogg'  ) {
                            await sock.sendMessage(exists.jid || exists[0].jid, { 
                               audio: { 
                                    url: namafiledikirim,
                                    caption: pesankirim 
                                }, 
                                mimetype: 'audio/mp4'
                            }).then((result) => {
                                if (fs.existsSync(namafiledikirim)) {
                                    fs.unlink(namafiledikirim, (err) => {
                                        if (err && err.code == "ENOENT") {
                                            // file doens't exist
                                            console.info("File doesn't exist, won't remove it.");
                                        } else if (err) {
                                            console.error("Error occurred while trying to remove file.");
                                        }
                                        //console.log('File deleted!');
                                    });
                                }
                                res.send({
                                    status: true,
                                    message: 'Success',
                                    data: {
                                        name: filesimpan.name,
                                        mimetype: filesimpan.mimetype,
                                        size: filesimpan.size
                                    }
                                });
                            }).catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log('pesan gagal terkirim');
                            });
                        }else {
                            await sock.sendMessage(exists.jid || exists[0].jid, {
                                document: { 
                                    url:  namafiledikirim,
                                    caption: pesankirim 
                                }, 
                                mimetype: fileDikirim_Mime,
                                fileName: filesimpan.name
                            }).then((result) => {
                                if (fs.existsSync(namafiledikirim)) {
                                    fs.unlink(namafiledikirim, (err) => {
                                        if (err && err.code == "ENOENT") {
                                            // file doens't exist
                                            console.info("File doesn't exist, won't remove it.");
                                        } else if (err) {
                                            console.error("Error occurred while trying to remove file.");
                                        }
                                        //console.log('File deleted!');
                                    });
                                }
                                /*
								setTimeout(() => {
                                    sock.sendMessage(exists.jid || exists[0].jid, {text: pesankirim});
                                }, 1000);
								*/
                                res.send({
                                    status: true,
                                    message: 'Success',
                                    data: {
                                        name: filesimpan.name,
                                        mimetype: filesimpan.mimetype,
                                        size: filesimpan.size
                                    }
                                });
                            }).catch((err) => {
                                res.status(500).json({
                                    status: false,
                                    response: err,
                                });
                                console.log('pesan gagal terkirim');
                            });
                        }
                    } else {
                        res.status(500).json({
                            status: false,
                            response: `Nomor ${number} tidak terdaftar.`,
                        });
                    }
                } else {
                    res.status(500).json({
                        status: false,
                        response: `WhatsApp belum terhubung.`,
                    });
                }    
            }
        }
    } catch (err) {
        res.status(500).send(err);
    }
    
});

// send group message
app.post("/send-group-message", async (req, res) =>{
    //console.log(req);
    const pesankirim = req.body.message;
	const id_group = req.body.id_group;
    const fileDikirim = req.files;
	let idgroup;
	let exist_idgroup;
	try {
		if (isConnected) {
			if(!req.files) {
				if(!id_group) {
					 res.status(500).json({
						status: false,
						response: 'Nomor Id Group belum disertakan!'
					});
				}
				else 
				{
					let exist_idgroup = await sock.groupMetadata(id_group);
					console.log(exist_idgroup.id);
					console.log("isConnected");
					if (exist_idgroup?.id || (exist_idgroup && exist_idgroup[0]?.id)) {
						sock.sendMessage(id_group, { text: pesankirim })
						.then((result) => {
							res.status(200).json({
								status: true,
								response: result,
							});
							console.log("succes terkirim");
						})
						.catch((err) => {
							res.status(500).json({
								status: false,
								response: err,
							});
							console.log("error 500");
						});
					} else {
						res.status(500).json({
							status: false,
							response: `ID Group ${id_group} tidak terdaftar.`,
						});
						console.log(`ID Group ${id_group} tidak terdaftar.`);
					}  
				}
				
			} else {
				//console.log('Kirim document');
				if(!id_group) {
					 res.status(500).json({
						status: false,
						response: 'Id Group tidak disertakan!'
					});
				}
				else
				{
					exist_idgroup = await sock.groupMetadata(id_group);
					console.log(exist_idgroup.id);
					//console.log('Kirim document ke group'+ exist_idgroup.subject);
					
					let filesimpan = req.files.file_dikirim;
					var file_ubah_nama = new Date().getTime() +'_'+filesimpan.name;
					//pindahkan file ke dalam upload directory
					filesimpan.mv('./uploads/' + file_ubah_nama);
					let fileDikirim_Mime = filesimpan.mimetype;
					//console.log('Simpan document '+fileDikirim_Mime);
					if (isConnected) {
						if (exist_idgroup?.id || (exist_idgroup && exist_idgroup[0]?.id)) {
							let namafiledikirim = './uploads/' + file_ubah_nama;
							let extensionName = path.extname(namafiledikirim); 
							//console.log(extensionName);
							if( extensionName === '.jpeg' || extensionName === '.jpg' || extensionName === '.png' || extensionName === '.gif' ) {
								 await sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id , { 
									image: {
										url: namafiledikirim
									},
									caption:pesankirim
								}).then((result) => {
									if (fs.existsSync(namafiledikirim)) {
										fs.unlink(namafiledikirim, (err) => {
											if (err && err.code == "ENOENT") {
												// file doens't exist
												console.info("File doesn't exist, won't remove it.");
											} else if (err) {
												console.error("Error occurred while trying to remove file.");
											}
											//console.log('File deleted!');
										});
									}
									res.send({
										status: true,
										message: 'Success',
										data: {
											name: filesimpan.name,
											mimetype: filesimpan.mimetype,
											size: filesimpan.size
										}
									});
								}).catch((err) => {
									res.status(500).json({
										status: false,
										response: err,
									});
									console.log('pesan gagal terkirim');
								});
							}else if(extensionName === '.mp3' || extensionName === '.ogg'  ) {
								 await sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id, {  
								   audio: { 
										url: namafiledikirim,
										caption: pesankirim 
									}, 
									mimetype: 'audio/mp4'
								}).then((result) => {
									if (fs.existsSync(namafiledikirim)) {
										fs.unlink(namafiledikirim, (err) => {
											if (err && err.code == "ENOENT") {
												// file doens't exist
												console.info("File doesn't exist, won't remove it.");
											} else if (err) {
												console.error("Error occurred while trying to remove file.");
											}
											//console.log('File deleted!');
										});
									}
									res.send({
										status: true,
										message: 'Success',
										data: {
											name: filesimpan.name,
											mimetype: filesimpan.mimetype,
											size: filesimpan.size
										}
									});
								}).catch((err) => {
									res.status(500).json({
										status: false,
										response: err,
									});
									console.log('pesan gagal terkirim');
								});
							}else {
								 await sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id, { 
									document: { 
										url:  namafiledikirim,
										caption: pesankirim 
									}, 
									mimetype: fileDikirim_Mime,
									fileName: filesimpan.name
								}).then((result) => {
									if (fs.existsSync(namafiledikirim)) {
										fs.unlink(namafiledikirim, (err) => {
											if (err && err.code == "ENOENT") {
												// file doens't exist
												console.info("File doesn't exist, won't remove it.");
											} else if (err) {
												console.error("Error occurred while trying to remove file.");
											}
											//console.log('File deleted!');
										});
									}
								   
									setTimeout(() => {
										sock.sendMessage(exist_idgroup.id || exist_idgroup[0].id, {text: pesankirim});
									}, 1000);
									
									res.send({
										status: true,
										message: 'Success',
										data: {
											name: filesimpan.name,
											mimetype: filesimpan.mimetype,
											size: filesimpan.size
										}
									});
								}).catch((err) => {
									res.status(500).json({
										status: false,
										response: err,
									});
									console.log('pesan gagal terkirim');
								});
							}
						} else {
							res.status(500).json({
								status: false,
								response: `Nomor ${number} tidak terdaftar.`,
							});
						}
					} else {
						res.status(500).json({
							status: false,
							response: `WhatsApp belum terhubung.`,
						});
					}    
				}
			}
		
		//end is connected
		} else {
			res.status(500).json({
				status: false,
				response: `WhatsApp belum terhubung.`,
			});
		}
		
	//end try
	} catch (err) { 
        res.status(500).send(err);
    }
    
});

connectToWhatsApp()
.catch (err => console.log("unexpected error: " + err) ) // catch any errors
server.listen(port, () => {
  console.log("Server Berjalan pada Port : " + port);
});
