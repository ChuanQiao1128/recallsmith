"""Temp/in-memory future interface fixtures; none are production registrations."""
import base64
import zlib
import copy
from dataclasses import FrozenInstanceError
from fractions import Fraction
import inspect
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import trusted_interfaces_v4 as trusted
from pipeline import canonical
from test_metric_wire_v4 import sample, metrics, THEMES
import test_semantic_proof_v4 as proof_fixtures
from metric_wire_v4 import encode_metrics, encode_ratio


def raw(value):
    return canonical(value).encode('utf-8')


def ref(path, data):
    return {'path': path, 'sha256': trusted._hash(data)}


def common(kind):
    return {'kind': kind, 'interfaceVersion': trusted.INTERFACE_VERSION,
            'cycleId': trusted.CYCLE_ID, 'releaseAuthorized': False}


# Exact frozen r4 contract/protocol bytes. Decoding stays in-memory in tests.
_PARENT_BYTES = (
    'c-rl~*>>7k*Dic7@9DeiD+Hzz_89xXU|ItXodBHya_9u6LTA|HzxRJWbFL*VfoPoIq*B`lH7YhnTFq>p+5g}F{MlMQe_Q_f_u$X}@m>Z!@6Y9^'
    '_wD)5!HfI+`p5R=+w`mVvR(f9?U_FFmb39{^k;9o{G;DnjtBI=u{WL%*FEo#Z@u9k-=4ka-tzg6cr5;x6^noV(|ul!hx0%2*(Ux+|7AUQpWQ#d'
    '-Tm1c44#+EKNjC!Rxg7W?|)|QfByG>io0~v&FAJ$BR%TItKJ|{8Ft&rX|YiCy6x9Re>NC)<Egb<D2=*_+VC+~+?8A1Z8bA}%#16OVs`pk9;egY'
    'MBVDPw?n6$ob?l>iPN^c{=6p7%2%zyyd*!*UN_zN${P${9-FgVtk-e8Vz#<*^7dV^;BE#p`fOeq4&tNHVAdMC`H@#F*n6i_oDX*CS+D&{YxMSR'
    '-d+{+xwVr?Pv{-%ege;K(OPrMe%{vW_vrJ@V4U9f6ZWnfZ>{?A<np<Z-t@=mSTEli4ifbpt$FU|hr@onJM1>n+rccg8Wd{lVy^zu>r{rcwtcVd'
    'u8aBl#-X44vs8@sMBmHB=-igwHtnrYSr@a(O);PJ++F(BZQHx&MoK=*q{q*lx<~6@bvsj8XQJeF>36g~t3R(V=x=yEkK={+oX7sWwX;j_oK7`1'
    'n0XTyd&=?ojA^}-UgqWRV*YjH;@^3DSETP0@twTArO&7IU#wr4;v6?_{Ep7?b8t5ed6zRw(OIPuJ=%Y<klyv<3y<z`L1(n5yI9~%npR~qD3s{V'
    '>^-d?&t1?x(_V9Q9y$JgpVx~s$1|+0i~Tmz3zzPopYINFhV+iT+ji*wstc?QG*isGUVmoqdTpGkouE4#^=I{QKQSCS^U|o_wiC48Z?d=KhMr63'
    'k+X0nPP?|w3>Pizqf2)?nAvOkJl5@0>F<elb~x9Phx?^>;_qp{-jcqXq~CdcqWAu+M(_QM`vqO>LF2BXok2dg!~K*yOnV!gc|V_v`}dtm)1Fg1'
    'r*Sv5iAL%DI9sonx7T#8L~Hg6`=m39ciSGmv!HW|;amp0`@bJO`>7F2ez9YBibt};9=((3AzK-zvegXz*GP})d?&rQy?Y$LEY%r|h<1rrM+=8|'
    'hyH%=w28lF{A|$f*6Eb!-*>|no`*FQ=p1ORZh_9ZO+1s&#b~X`LwdpAxib&+yKxkM5bv-0?G)X&_0S?-qjRD=OnP)TYq^i~sMjeD2cX5gL-ZM2'
    'X&$Gw#oV|zahgl>j_5lMt$i@0pI3A?Yq~4DIbA(9E%%A&BHQ1knV;$N*kC?|3>bl?)LGD3<%l0V@Nm4>&f@$wkQ2n`JK}TV$?dS8D2gng?-5N9'
    '9nxN#gP1cZ-c{Qz@VQ!ti*+9Et5&nCO{}Go5uWYM?Wq%Ic|`Zee@}c#>v&k|^-cT4Bl?cqPW^?>c=1fUUVq4{^}LRH?U=~4d}%|xJMDIG5B6OT'
    'e7?IIHrieFx%`fKGsNfM5q<~mjJ`YC4EU^48@k`6@Sw<X@Z2D8>$75dr}xn_9hT)JCr7<FWd9a&a5JE@a@x4V7JZhZf4}aPjKw`~1|+}r+PcJ3'
    'w1*|V>l^XMC+wTn_CmBWEfc-4>`B;TdM?QU+zHF!HSyHK^`E~Ty7ANw^j#)>P~269jb@Q(%~?D%AC@-#e2ey1AK~nYb|DMzi0{+={8sOo<f*;v'
    'CkEIXt?hN=5Y0gs(OMu|alhb;zll$1?<vsR0_VYeVaSI-&TW;9CmBF|MfXgyJRR%DQ%n5LNeFM_zFGyF=+c|;TIo!QM-2K%Ez5D6`2W?yzWebz'
    'I@{d5-0AL~cD_#H_x5J~JvHeZH?-~%?ys1avm|-Ac_#j$pJyb;CcSo!?z*~hJ1oz&ei4~QJWh8^d#il{J&=wi-fYPo)7dv=jilRi6W(v!qdl}('
    'NA$H$4s`LRJGV)8)mbl#tYZ4Z8P>|0HsT)36#DsvbO7B$YDepP!JW|g6P>tw;-?bs%jt}m{(AY;o}RO%vw0C2PxO-@ULCXkVEIEb*@C>LXPA0%'
    '+3nbCl7ZlP-ZPyc(G}_A_G^;%OnXb>J6I#hnB>Bl*?aIR<UME<v^R*`OV9+)!p+<b>+KxrRlJApLhftm#BF@O>C?G6&?oVs&}^c*B_8mMyJD=Q'
    '@Wry%324f=Te+vbtizYB1()uqJ|ekE&$A#GpdV{EJHkvG=xpMBrJv|rN#2m2Trw6(q(_5}?SYo*E*FDBeNT6=hHij7?2?>q2KdA0Z+ZvmjocD^'
    '_cfDl^y9ByIZ=&u+b%t8J8aGD5$Or03)<V(?HujpGvN_q-F5KNg6W6%v>n!=2WQ@tbj%vMW>COcrkIatEuS;<?W)|cK9?J@)z?gHRqn{o^!tDg'
    '!GomhT--^)CViVS^j#|8p_xs(z)p}XB6)kisXtVPw67WQ;9pMr4re`OIY)b-GbH}pLRMO|_C=TYW<VIsfjnm!T20cOzBoh!-2n3dKiu&eI{fU>'
    'AVF9r&U9w#G{U|fFc8rUXmP8s4RA||{-(0gvbCHDc(awQ=bxbWl<Z)P#Ij=xej!|D%em&OgeAO{IzNM7Np}}Y3w7^{ekZ*Y3|`02*-9got<ZNs'
    'uTH+TEaqsR`P9;R7;fqRW8#IKJ0qE!t>^49&PmBNq3>N+_~bL4&4g%9cq@3v$kZ|QtlcIZLH9v8YgT1?YGzVvJ|Ci0x;vu9l*Y|;-u9Z_KLQ5s'
    '6K?2_<(`~EKx^2m&AOt5XTCruLhciNST1xR_Q*7eeK~{!7LX&5`}9oOLuSjmt53S0)<86n#U0Y;UK}{jcn&bP)i02)n|Y&<?!{fkU#CwG_q1lh'
    'r?VB&y9<7!JELb5>Q;Zo@`>bfop^?MQDYOvvY^iaWKsJy201{wfu2?0&~r)t)fa;}cn-R63%=~&JG4)dbwgigLhi8*72302zY7fFiCibW)vRsx'
    'SwXKE^nbAb11w0gnE33Q=tz4>^!!=V3uHdY)NjBhcqYkWlGUkQi7*H4Z8RWz5ucGf@xUV_M+Ljm8eGz4vi{{KwjVNSEf1z7Gg+1pZAIMo;r9>s'
    'uW4ED)z=Ff!oGXRV(?-0;oiqK<%~%mpzVMkN&m;`Z-A-e#J5vm1l&LA?{zOuXXV?;$9MjOcjrNGsZAgHj`SAM`VwpSdcUCe)OW7Z4|L`+dj1Of'
    '1M-vP4a;S=nMq&McY*hnO%PtAKKF85?y4L&&dA4kb+YBsOP6F;z|#)d1@>Qr8v@;U@a$%0Yv>kVPSW?PUaymmDO@-j6w-7*HEmau{XqD+!158Y'
    'Yz4jm??K-&@6V?j{|t8_UCT7Wc01Woke_m%>dZ*LkPg`O$zBj#ToL;K_R0+B<>M@t1!Oyo9FcvjyS2W<9r{>`?NeK9>p*@&4lzGNKKJ7eVIP*4'
    'n;v+hGh7zQ_73Ej#d4nPvt#{eVlT2;dW<Df2Je8U!o0~o2--ux1Gz}piR@$8p777~=T*{gCD5%p*EDqW))m=wBrgW6!|AhZ&0^U__6T9)HFOHE'
    'KjELdM`yhg9haLp(Dk$~$YIERm(LA0=gK>zlP>If;CH$+XKwHL*-F0gJ2kJx$>xk(_&;zP*%GX0C$O3IncxgG&nP}g5DkU)1p6QFrh8jM@B6ZV'
    'uxb6F1-ffi#$mj#F?2}Yv7MBfX*nl%VXlqkJIe^-m7SI+q4kCQG2o5d6gDK=UdmonYw~eOp!;dx9l~qSxq0DJdKdggd!e7LPcvopZ0HVs-YknW'
    '=53_^cH8y2vRyw1x{35H$u`_a8GeHT@xv@B_eL_B@XVa-2hrWUXQhXPmgs%>dyAgKxSQmL%ind`X9K)b)cYel%lEet=BG0i`W?B9XRIyVm%0l('
    'F1C|F8wo{Q1@Scz&+++m+rX3TclxZ~ZQ!fVVsl#X9WL44@G*f+x}>i6;oF?_U6R4MJz>Z({SJ4Qtumj2p1i4g$1>!vWWR+sA$qp@jTHPNQ{l&L'
    'fH_HycjN54@pS<1ht7lV?YUtY{s8tbX$(crdR^c=Np^<#3V6`q^9kq#=LWlv&yH|NF_%uatcu8uc1q*!$IKKs)>d*%V@Ww1!jwc~9%LnBGj+}+'
    'CsRyAbT$*x9a94jDNH2368iT9m<9f|0ns;M(}m!E&{~RcIX$zZ{7CTCWRg#HyB5;r<(Rb~8BaE2YUXB=xo4tFq967<mZ!N=8NRi4X-|Ixdq(WA'
    'L^@V(c31Qr+QW$C*bsNVCfeTvSHoA$XPd278uYt<J_Wvk4obJO(@l*&BOaXecIg?`-z7QMBm3R=K^I6*5RKDai4UpGz7oQHUJP=C_{1YU3+znm'
    'hR!11D@-?f&%W<WFc9RL_^IR`d>VA~xqWY!Qumr7`R>54vQakH2JeQQ#6C>ex7w!9dn?#lidV_5hkY_tJ`c9X{kvu#QQr66tVw=Ng;z+<%;~J+'
    'Io@9gU&*=o`kn00CxdU8&JQpmbkd6G8~&6TWK2)5p)-=RCmX*>^hx>}HV@OM_<bRRJor)#x=M|SE|;vY@|Fdk7W-hx{wG~J#d!;j*(3Jl!S@n}'
    '9LkZcz0mdt{2JodC)wC<v){%)`|d17SglUB-c-)7k&X@Kw(?yQ&*xzSd1O--H^lew?~*)+pF5SHGgq+)$hocdr6`}j*kpKSw^P$Gi#6*(T1Qv>'
    '7kjspCOzd4#)qu(V(fpAHM5P0J5j!w6?pQA{SxUFu%hpCnOC<C``*|tV;Kd1bAUs)zK_Phrg-L-ab~A3wB2@MBEO5+3+&&0;DbXf1Gbw7+J!EK'
    'KUmY@jNYH@#$P@7-~ICo`6%W7g8eJsJA8now{b^(bx($mj%B6qI}Bkd!UZG?=skPrDB@M37mMW(-HqiEK6Nu}Cr|nXl9P=z{7B#-l8Y_qzioe)'
    '3Vd?D-EG(E+3uzZ{WW`Ky-m;9LJrV5EtNl=aRi;&5*V~UhhNiMfd+|>;oq97e~TZBuzeRc_`Hg<1FaGt!!L|=Ru@jbb+kA5N7TCrdsS(VReF}I'
    'Y^XH*nMp45=fuN=NA3MH+Yd3sCE~pf$^RM0+cpE==TD#0y4Ww&W^CcxSMbY`-XS?!B3b8he52W_)&e_JVfz_mTnYRF+bPC=FUU;gKf`CBN0N0h'
    'w&mhU6|1X+^#c6B@#+q8MKA#C7WfTV7Kz?+7G0Ac4SG_35xSS$0<`j6sB!!Z=jOsbD!|u$=lk_IUYWP=+)OHj14;L--SOS9A$~`k!4^C~aw4hy'
    'XDsjN3<q(R30RN#onSxuvRP<U#WuA+UfVLTr6E5XF6(Q{W11k`Ci<+lVGNlGY^8pO?JukqGBL^?_G48p{EXoH8S{+N#arG#-7|0x>r41@A$#e3'
    'w?^y<vC@&)Eq8<yU|%4H1>0iE_5!U-#kc5wJMeEJ4r?u$F7wuieZpfEhb7&l;t(vmls^}^I;Qnjm*ow|1WEUh%;H!8y|ewQbU<qV+_siP>tw&;'
    'U3K}lWj910<)+vl(K2+Cid(&E+A`xE%nR&iBy837ZJX)~t#umWsZ6?Bv+fZOoeuJ;1!O4wK2FaW`8-Lq!nk4wUus>&A(<}{@I5*WYuts+&G&qV'
    'dtrPo@exm9wW^$F;HzFJnuYIjOT0$15jwmQ*jYY?6&)`6(m!|BsdNr6eU5|qaZ!=clNa0}@Ez_HGJ@#?*e{UHzFfz7l5DK|v0ge0I{Ru8ekj`i'
    '-c@u5UY58W`^88%)LzT68oj$@;cQ`(YOLYwTK2aZ`hD)x`4}{=d>#^S&HHo+e-7CM?t(Fn#L~5&kk2-Vv(`6i?-CcFdm*g0l-RbN6x?tJKek}8'
    'g0^L}yb1i}YV9~fqLq@~YfOA7h>h1dE<yh%S-#psx6>UOeoNrU&whLlHvA#(VV`6?#&Jiwi?zh{d>rKa1`#Xo!`5p^ED*BHh@A#FQpL@{XB@Aa'
    '*^q}**m*h^gVz8b?7YrcRj-G5b)|UK_if|7KJBy-HzN9Lw}3rBcZ^pn4})zb9Ou+AeUIq0&HioH6`$cJO9c4<ejWtkKy%r<w}y=JeNtf=30oAt'
    'nHBLKVK~NHptD_>ZJ`{n=F}y*g4hi5J2-YOb{Nrli}Mpm-oY-l1_i_}Auk1MsCW|DIdoQpOGsuWi<#Jei#b0gzmXXBa$U?3u7@1NUJ?#`$`<f4'
    't#!^ifpi&u_Wino_t=&py*1UbY{K0eU^>L3NRP1G=XhH?_YLw_^a$fsl2cX2Vl|Z`67oy>aapZ{1jj+Ha7<8aLZY{H6aKEI9}BDxSzd&FH{d<u'
    '3FZN1@1-Co$Tp(qW50!ZGO$Iqa<9Oi@cnmmTu%G&k_SH3t#1=5|CaVw_&nXq^IeLsc81)9)C#o4af8h8zh9a~t2(yEJ;K#WCTp3IH2tWgr@@me'
    'r!l2F^Zk{u5k~!-&+9k?lEtqUa(eU`4&u3`Jd@Vkwn!FA?oul@N>?VW_@i3S*TSo;J6lQui#|3OYk;N>_U*@|Hu_%J&gM1LWY7G5mOGMbVEMEs'
    'v2=+SC5u@v%V)<i3-;s8IQCB1evp5ab0xW6CS3!29KHn7l`4(}`K0%z^$PBC$oU8Z$R^}1<qZF>iem+9RA-W5%x?J40{QvGSf2hpHf+!W<R{Tv'
    'cI)R+^~`vs5g*dFqWD+SjBRlKzCV<4e&E+1h<<@g<ot`UttR;jh<h6JX2$o#W@dX``LWp6uZ3cwb;9uM{~=5QY=yO(?;$%S(P!UXZVQ{n$%r3V'
    'y`OzxWzL^lc@C}7Sc{MQd_Mtr68f3s5%Ub$DDW?JHEzuq>j#c+yNK;G_Q8D-t?jj6P2KO3bC~Fy)%n_X7V-xCu|2?qmXAY(7loesZ7&A8DaRQv'
    '5T6IWl5)b2>kAfQ{qN&o@iP+E!QJ#ohlOkbpHG9ly>MPy4!#4)_2K*q|J=-2g`Y=9cIDdl{V0BRNmliPoWG5VH*JiV4##I&*<7==^Dz$RBnY47'
    '_G~-mfpvUrqI{f)8!O(-iyRPIpOWo<hg=_yJtJ4Z=`6&5lZS2U(7D(myRz9$ZLD*ST#}C(BPiTRvQ+%1IzAzo)W88MJ^@`;+W;dBkds1o9P<qP'
    'H*xWc8Zivw<J^{iPSo+8Wmv8UzD%M;;$e5Ea#lbuYvd`Fm7EqoN-fYig+R8|rgpw*m2!j;cLvWYjE3`JzX1G?3*@1Rt(dd$v&(nqA*N*k*E#T!'
    '5DnDXo}P;T7Uwvx89piTHAqgSe?BZzi<wc7GbZ_KfqYYWoR1CIL7`Y1ax7Mi-SgmQmFFooE&L06<u4?fuvDIBdcw9T;kX`r0NK>n8l6GSu77S?'
    'sa!i-tw8UDV|v!cmD~Z9M~JvoHA(!sXZulOZ^&LhXQnQ>tF%|Um2B2qxk|wIl269|5#^71jO#exO2-rp{Z@x<@gTY$a=o=O`BY)qjl*(~Wc=9A'
    'DKYHa+#LCPW%#9L)ur23-&L4|upDF&$$vlhLB|OX;xpBe<l`bw1o8oPiXX$@0Rz%qBNyV6j@uw+WX4-mTp+IS|3Y%j*uQ}_ALf5aY;f+9E~%ON'
    'Ph_+5W2)Rl_*CegTmG5&vBbbf%d#Kmsj#VzJ!-lbBaYeCwu{8Q<gDf-YsI$+AKf0<m~(Cr&sKb3#7I@1U2fGy?50iFYA5G|e9s!^1KPBwSB}lN'
    'u&+XK2l#?GKWx`Sj4F7?hHP{ACV`R3_R{eX)@7j2t@f*S6CUlUrPpDBSGtlXgFLV$a-uj6^-$Zwc4fZ;+ZvXZpR7~+GnaD?5W6KDFk(5XVmt?a'
    '6}smVd;-%zp4{o&bNE@<mLG6#koXG_t0a5&G2;dJkYwPD{l*+GAncU6e<9nAuy%>xiI{L-`9Z`N#_>7G*M-hg?)o|0_bg|{r@1v{J!o%L_VKJe'
    '=R7dhk2+`4qR+e;>`V4{#D^QkVUnw6=C~c{2l(U(gOS~lMC^G&7@vJDUBsPc9H*M9JWD@My4<b<?+YK1U5$K4CD(z=ni_*XgH9mpNhbDi=VHfz'
    'R|8osxe$9^%Yk0;^F&pwnCN-0<%9AC>$A}LwzSXOTIFvlz6f$x#V1|c!1j9LyaVK>*8<;bqQbr%ZHILckLa*}2pE}gNlJ1uNX8E4Rl=Y58}T7a'
    'PFpBHf@6o!<?u&)d*qpRS#FgiH^1%ssrTi03h@uf=vBXC$2hN};bV<uIB!?SCacKT_B1~c2Juu(;DDAwKJZUQe&>X3#)rzTx+8r?xSsYOt4_Li'
    'gvIpVl<EbYpP3?g>B85+GJh~nLrxgJr;rUx7$=l#yg}YH?So{DJ#~Z@{d@za>%1EmUtCdg3^KajL1A;k>yW#S&bLJVoB2GtU*LL@JrlRBbkR|a'
    'lj%4DBOynsx{;VE$pMdK3gUDbi8H&xqv=Y6{l(fINLMr3kADC6;|#i(-rG*mGhY6d99EJEGt@oQUmWCU1BYacGi%CT2613CvbD%gCVqZ#8Y$C1'
    '&wf$y(YO4Vg^EKiyPXB++ymbUX3c4QkI%smJGWqO;oBm*UH0R-X*rZf13l}&2PU}>BsT{NYxgBT8?g@1n##!phS^G94SZ>w)4LqjRZRh{ljQY)'
    'Z9%!CP;6o7B;em?oWOaoop@lgbu-#G3z@}s2|e3`Z)YUFZ51bPc^a2%9FR0*J7UeC8<u0p10cC=@&jRe%PWgKf{vI2{~XD>uv}AlwRG=d+X4dx'
    '^esA2;}GPpW4%5-)168ThJ7U*Biti5mhNN(+0kX6INd+}yC;}c=|YQip`y`Twa&IcI5uO}JM3Z05MBKR*`<BQVf>|XgMry*4)P#WJxP#{iF|5@'
    '{Za63z9xl#Lwrkmv$T^MgB<L+mH0cAJd(U)!T)p4(G|bF#Eg<<&{V-*syZb_@8LL|$Qy@n5n;2yCp(8P2eu&l@$ek+Z7JV5Xolo`LFu8a=n<s{'
    'eSM>1Md05rt=&<L2K!qi77E)~_=4+1NLJGKff?bOpr4Uno)dh)`9mdT&wf6NBWd3N<0PU7*nTc@JG9R!pB<|BO`u}~eQ)HWc?bEN?hEpNjC}SZ'
    'x@8|jyR_$g4bH`W^~%GS|MQ>!^@}P72QTy0x87j2^lJqlP-{c@h3hNaNzJGY^!?~Q=7c?`>jf)BW3~PL>tjt~%=RQp_s;nnljnAI>8N@vU5~+M'
    '$MT^1k{K?BwfH@s&v9*xsufXufxOmmtmuAY!-qYuYzFPhraTk<rhOQa(_!D0JDkfkLp__=77~AfAEcK_jod_q_=>Q7ySgun?}YRieE$~l;$Riz'
    '7R7dzhhn_ayx%?L?};bUxi78CCb0iu%cuA|?xZv%9&W+U<}`f2)*9GH=|uLA)MBqCg=vTI$qwcv=p~lRg2(NW^I(P7*y+Z~&D@ZlfgCWRJ!@n`'
    'ZpP{TlNez}!r^AlV~%6ipu<!(e^2zAUWwgRZEMW;r5*Tv%WW5VGFy7jEAS_<tIA{IJa5F}2<H$_!xs;oGz`@qg>ip?6FG0o$I8fIV?P7<exY+b'
    '`eUR1ie$XrUwO9JOU%!);BzrzABIhV++>#d9Is~^C69cn(%&LWR^D?bkOO{>9$_x%M%H%)$ki&X2mXO1z3Y|r?GtJaXDhlh)QZY;=({?9fX*Sv'
    '>A_uV|8lTj!42Ixd}@e)rN*2m5aiUUn5?PK(u)CMOvuIZEVMr(FUrRmww>*+o=En!R4q`D-&uuC0lSZNQm_W-HeR>*@0ey-H|)euR1-g@)K6M|'
    '{V05Bod0JjOyv8vU?&f20sd|{ZD;7yx5Nl>?%2aZ;v|CEm3|PvNZy+}oEPKgSRK^Xa2+uG;<~2D$oo=vKYV$#S)Q<81hi$)j3@DuJYr%wju8>x'
    'i;sogNxEmRZDQFM=%pJIo5Wi`fkqQ0!lMEI0LO@(U{`%#W>)!Y>3c46U}O4c&b7L0D4#6R_t-&vpYB}pFJ6o6V~(oBm<Bec{=UogLsk79RpVUW'
    '>(7I_0ROprU<ATZ`e&jI$Vm9-Ed4vdrP<(a<$3J4RT$3V8btWnyQGU@$BW#~O`U?|F7n^CBrYL*YK;b26{iq9$No(pzr{&DbG@~<LJWlQfR7h~'
    'y@z5wCZ8}q%`NF(f%%pyM@HqE2K5YOt{tsUdbyO+Y4o?^M{KorDQz<^wVl_A2Re)N3fnANuSpC8>m@v)^_79^$_eqgsQh)DtJN17pC|tEo<qEf'
    'n)Q~>bK$r!^h6_Tr|W!A(5svuw^Xv{INx_HcLDzq_U?AH?I<-FN+)T#gIen>$(*gqn_U>VpYu^1wkHB!A^MM3{TitH3(=e9pmuIz%Kp?&<&fk^'
    'cG6ni5#kW;q_}Y>6<tdg>wz}g?u*!F-VXWqW-fbB8+l9*(C>%=)9-dBZ6IGCF`rOQydMuMc}niCXwQ40J6}ICO|rd|4f_$4ox(LiggeI7Oliom'
    'jCg8U1rHK`lYCB~ZduC&&Uv3m{E2gVmG1;~L;ZZsj}hr}D)X8~x~7$7EA5f<@d(o(cDw2}Qc8ELx|mFQ<`VrqJ=_O=^Fr0?&a2>AOX$(r3?|uK'
    'C8KhSL$QaDuXW?ZnXbj|7>mB|&vGl!iR44x|MyF?j=cxIsw4c;QZ-AT$<FcSgFr|5XI|#m9IYi!^fk*_{et$@D4&Mq--)*8B!4UepFZz96!!zJ'
    'dRDcvWz<2AE&g}dmjm38<UB%=Q*4t#?lI=APjjWF=pe=^J=%l9^CMSm9gbNv`3!xY_TwnXbzxkg>f6LO$!nL`f!JVyEzKB1>mA=G9*X}M_OjvQ'
    'xqlJgjE+lsuwzHM)&=z)&yA_>DS&!g_%+DZQ-0}#Sd;L!${U{p%Xl+ITe~37&BsfsK04f+19_N4vs1TSrSsBs7Cs}66SEH#KCEikm(WNBeFBus'
    '>yrIIGEH(Gb?!r!^M=&AE!;VB>EI7a>NQI)Q=M~|T%(7G<a#I{Q2w*83woUe>v!aPRmSN=SFl}>|4*`udt4y@W<MHt+x8SS-fjneD9>{qDzBA%'
    'ao=s;N9_^(idvpn7jk=2@oR2_*dFItDIa$z)*~^U2fw$$t~;SMG;1W+>3!{5(rLE#m3=Mtl&@HoJbgaP#=FhRoiiB@9|P=js<*>}dosjf_xN@F'
    's%{*-*o{@2L#w(U!k-6hEBB&({3<8f&y&w1CZzN*ou$*}{1c|Rp5I&LWM2x@n;{Qp)Q4{|)XO3_b7rcR>(FNse18W!f$QpXX8#R|SHVAqS~;Rc'
    '_@h^Z_oTl;+sI=qKo`DD$QEu_#)wU-xUuLCm5*4rx~Pddu!WTk;_IWq_T{mqY!{pxd|eLrV0hiQ%0>`-H;sC+X*UzXQlyJL_7RGF6u+WiZ*Lv0'
    '+f6DgmtFUegE>a52z94j?r}i!Vy5bQxu&BY*lry2bWrbS<_$^B)gJYoUCu?a??|33y66Ew`_%nlU|X5{r@NhMpPtmB2m93iN3rFT==~!55FcEq'
    'Cyv{`TS1mfPXp-%^t97hBb3K)>Q9NyjMKS;XQ?wm{x;YAtfclWy_Nn8%yS`{b~3s@f#g&56X<`CTS~5`V@aKQ`0hzQZaJTg=uyi$W$O^%OU;0)'
    'r;*+qI4jtDp}bPl?~&X%IzK1>s`Fhx$?sb_w?X#cpCRKlGnYi{pty;>rA|L&uLb=C{+3#VEbCI*C+9v4xW<5V?tE+5b&4l4tcR95Z?WD8a_!{~'
    '?dc<GpOmd%=2*1oh{2d^@+2=!`rCXCY-I!29q16&JrZ~1++LRBWIIVcSkPy{=sSQqF>SvBw=c`!$xQNZ)G~9eU7}93!gWCK`5<nCwUXX-Se8ZA'
    'r%GH*=g1aOCzq~Rq(k`GT<>Mt?p%jRHr`iXpW7+I(D$n^V<QG<Bi@?+N|=%E+L{b<W=&dBa`)o)v=bK@=ved&l9hI@;@be_xqn_>9r+MkOKG>O'
    's_xo<f2XpkHRKG+2HqU(QW@oIQ8kq+?veRy##xW+2MJShe1p!j)~wR|tN_EdI49=1GkMT;^L|aL_#YrwB$f`})ZFwX)As^w#OJE^s^XG9{tWhY'
    '<e#PcHtG}5hXwgvkU=(TYvRbSML!Z1``2;4g?gUcJ$%n`PsKBIAB}ob>nvxN4A$HV;w|<>WCVJy=vZyPUEP{78S}jKU3U^B<B<o$K5$jjujQ;@'
    '@=YiQ)36x>TsaMDu-O*SF(|T6L+2Iz9<&fq+YX!Nu7dkYq?5WXJ+R-zrwHEw(YThALHx?^tCpVm{V1~8J)O;p-WBJw_3NcAKiB80Veb=<gx1OD'
    'qht!%N7~;->#T2pzi9s+>@ew-<o9JD+U_FOHbXqSZ`M5S44D!6`Tgb?-{=^w!s_9=V$IV#gKzNuRrK>&M(SF4uRJ%-q*I05ILzUddJ*3y5BhEJ'
    'nZ~jk)`#=T<~fcWQ@i98VoGP~zbT&i8}PKm{mPsl!h94V8}M0j9hQ@zH!DrgXF1bDZYax^q{-JD=jD53+<s@|+O^F5lCQd+TK+b;$66zWUOwL('
    '^y^5hCW!Gh+Vxc6PiDH$n03n0`_%FXcYL8=!NFb98Zz9QAXxiG>i22C$On(>{Os`F)w)F=a6YKy@t8T<+P7%>XAbwz^&^+=*ssk#IwP$IHqO{0'
    '`B9(a9wYCWWDPwZJ>s}G1KBJ`dA}N8N}V5KiDWxuQd|>^-UKJ;!{qU})FOCa^_oQv#{SEG4YC`QK2rS$4(MI?XW99>PtFOlPuYzjxu<Q(XqjjF'
    '8n0Qq)*FgfZ8NU{eFRoP?}As)$-CZQqVg=}Y$xKK*}B~&+4Z{NcXBTU)1PC=C?)UNcN)EZe!t{Nah)mi*n!TQX&+^v=gjvV$fTL%CwAgm&hlOl'
    '{IJ0tI*@-IsSn3JM)+mde(j2l*qZy5eN={?*Ew3oz4>b{?+$8nGs`2IJjjXN=;!&iWmrC&=MmM<C6xavwNj}V_xjwWeBZq3yBq{H<9=Rqpr2Ec'
    'M`YY(D9=~v+2bCJ@Kc6ruLKjtC9dh$f(K_N`SG0~-#3hj%st+}=v@CNvu+^AHe=Pu<=(^3Ainac!5^w$K}T{14|qiKD(%z@d`PIv6qz32+JWCk'
    'hhx%yos-``Lig}cxw6I{Rn8`4IN^f$E7`=7R~o%f&MQKlML_EclLYydmd*n`;DZqTEBh<dV<UO629=+h($6z<y7=z=8irs$e%>YB)dcn%(b1yI'
    'deY1(mOfpIe*N!!4aZ7!Zr9%EXBL^$Th63~e^F~XMt-U4XK2<k1$_$DUHG^wgslcAFx7yuROl|YE^<XxtW@Jl^nCJjk|l>%dfv<s6Y%Lj>fQ{j'
    '*jfd?^N^liht_1V%n@7rp|;h$NA~~9HG1W_6ZEPIZ0zDg?6oqvM{Y@s&;87K9AZuBxhQ;K^nmi$8;#L}{fIABYQ4fZ)$F5oT=%2<LLsK@1Ub(p'
    '?I>RM_i+NV`g9kuj>~v9=tooG+7-U<c#2~|s<(r}*Je$d-}gsqtEI2ounS*?_=cFD0$LE9Npkp8H=f%gukC9i;`}dS#1Ix<hA^Yqk18VnJ&cV5'
    '8|7<8_Zu5=Tu|d&Lmr~1(eTkc$54MAUym*nE;RR}^X-rJt$GllMr(x}CyoI|V+iz0B-~Y6hW8NeMRUkkS_XFX8ico04GMB}M_>I|?c9$&d_|Ad'
    'PTXb8e}JJv_Kk73H^g<Jdokl?!G1`OcjKPK|Gsli5%M9h6+-+T)JT+fQWqEM`%=*Te`F0uxJUX}Eu-ui&38c$2cM5a?|s8Ls2Y$G$Iv^0&Ex0o'
    'brPkKW2NSxVd(s)0H1oHyyw6-wCT>cuephJ!u2OY^Bf~3xifNh)?D<ne~$d~2|D09da|{G{7=G<hdv?G7aY(E=P9kYCvaQz{?}`<E#i9-xpEv6'
    '%Hb@hMo-8no3S>0EU4b{(i=p__EF~v8e>_I@ecj|OFvhNWWqteIn;cc`T_lNIZu~!woL3HF;$*BaNLu2oK7F=62wjkXDm23J*)j#DnCl+ZRSlq'
    'sO7sUw^E;+M2Yw%4Veu2EdH`i2|ur%<3e}M1o}NDNe(HwJ-h!TeNj0t3H6A}pvJWXKa|*xiB<Y*wv;m7J>(oc;p;C0j&tRfUCEyq6$=Z}#h*E6'
    '&#1d&UNm~kN^JJXj^_Bz!b#X0?(N7uRv`1mzt3`x>_Wdk-V}M*;^*oYJj9%l!%gRo9__r&9P)dEvo(59s~Dc_L*^v-@5>uJykBzO4}TuQX_6;Z'
    'Q}iQwE4hX4O(d~-c^+bdkuu7lDZ-71wK8Un)XMRF+ASk4XW)jm!rF$tpw3yxNI36B&zI2s>(DpBQFXyV-!DVQ;=DVhaSy!|CFgqCLr!Qo576{a'
    'AJ+SDf1;z@AgTM|zFKBYCFxVL|LeNXwP4>i=Tu>Cf$pixF&^Y3)W8Q)C-RryFV*lFAx{Ll4E=kbc9Pf8XhCiwm&f`f{d4UUVV8cT5sP)&_tMuM'
    'aq-TI<7-YQw(3uE!zVSXL*<18xjd3r6v!hw54?l+SWtc*uD_JJ_w=wG&#s<5tKV%{e^oNEWZAYpRWjRnC1DL!?k3}AliqNC&@tT0nqzdpydJGb'
    '_YFYZD))t)nX?|4#|f7|`hJO8tdcqC4IS7G+%pJ${1hGgctGrL6Q@=*{u^-}&Y1gp`89@g2G|2~tfZDLjv7ADpVljg^JR7aR282L<hYS*tNI|>'
    'D~^flzAo_`>aBGQcw^+nE+zi~H8DIh1GOe0U4_`0)Uj|~9%y<D3~k1ZAIC48Gj$Nx(0;7F>eDwn%v)0VuAhurJMhn3*94h$B7}!FgMgoz?p&SE'
    'JV(xl+5edPH!iy9TilL?{H`rNLoe4Ks~l6Yodth|dOa!`V91+3diBk!n%@X-)pbrXbSCgisCMCLcaOXa)vK{8`9-$9a8#d52fjzuN4T=DB)Auc'
    'pI45&v3l~LuOQctn0d*%XPZ6Ye8}~IA7ACl20i;=>kp8(g&qfF??m)mV0kX_JLsUhAZHBz(`@ZED$h=RwwK(j67F5FXi%T#$73G3hH|v%ckESV'
    'Z1{EBx_7vWg(Ym|ZzCN<n96~CK;O4cRn=&0Pu8mYzTSiR7tY*9eq-SKYu-r@Jl(re<+$ix(P~Z)`}~gk2&BZvBzq6}pA7rW^wB`p<NYeXd3)fK'
    ')3qt4e~$AprAG+si|Ueal<Ki`P>(F@uoS=fSV;Xo&e%ZSW%eDNi@!|HLCxxkNgZAay%iw0SKxWW#y4Y|dhU_#W#sp9RQ)nTz4@irn&2jx5yAb%'
    'A)oZK%^py?M~%kqGgV)vap9*>510_<PKEJiP<thP2Sp#5{i;yM!nqWKvGiU-&l&EkRM0+J$RWZ6aa(dd^QkS-D(7ArYeWvsC*3zd&u>vWTkIRo'
    'p(k5P^al4rbk+O_^dSrRhB?NpcxjBDK0!>G>xC3{H0E0A7;9kD2KgKGe;0p;TFa5y7lv~dF$)R&!MNbCFRYpw!ZkLW-^8+qYtDl@Rq6d1SGnxF'
    '6xQxNXSDCy$1IX#Xyl6M+!}d@$w$bQNEx}V%nxQy07WBQGYS1e>yF9X6XaRUr{=R&{?{G%@>BYsd+`eX$f0g<2OrJ=_3&eUXN>!5h)-pwaxT?8'
    'pP=uCinp)*xn~FT60UV`Mdkw;{y6E=H=n9}GO5cfXF_}z*tmsI?l$E11oFP?&!~y$38G>HM$WL`lj-DL==^IVA1}ylr*lCc9LY!D<D9v_<8hw`'
    '6<a%qJqgwpyIb`QF!HTJI^sB&{V-=Ytb??i5qh@td^gTVC7G}*oB1QUf2@)hs*Za^IDJJ}0yAxveazM2JOTR-ct`SSb5bXiMO|C=OwR)!)2Kdp'
    'x<A1ka#@vru*Qr7Og|j){=p18U!NY)nvV~3ULATAAwN&m(I`55+UXfP?#7?xgdVi2|AD^apr*&@%d7I3xqi&3VeLw;Enzrd2;>=ZZ$#Da(PlpF'
    'Cj6LzT64?q!O3>v*tn0d{?t8|X0GaGc<7Vjx}`=4+euz)r?ld_Th#B<y6SVAdpa`)m3qyHS`x{N<NmRE^u;IoHFI-W_DT+rsuv%rJQZ`c*wOqU'
    'm77Q3Lq9_=)|Fn$<7Zv(>|;9QS)*n_Y9)Xl0=^2cCVC#=KAvgK^uEVdEcHZqQ~0{}^4L<gC!Lq2=pe@Zmk39d<EoC2`}4<uajgDqx$*6LvBLyA'
    '6>RQ}E4I?2*^J#q)XmjY|J0W1H^n^|bzi}6+>bur`bIKW;ft-zJ5c=#Fe{@sQ+a#b3kbQa*`fGtke{P^^mBa`>^k-#iQSG|c>^0iCPcQ&9(Wyr'
    'jaZPGRp^Z&JyZmHN$)wXlTPY<BtJ$lv*&^r>;`H*Q7hSJeYrG03-O=i3{Tbi(|(^!_+KECxn7cee}tWEU`@%-ZTbF%oYhZoJk#vM(G-m2s2V=D'
    '%k;Tuxxlo;K0(n7+P6V>k&1OY(lfWU&n^x5#`VtqPQ@z6NiSnw#lEI!VzqzDpf_NSbBd9VUTGG$6`qA-&e8Duf(&bo*njDMNFLbxN+XpiH<P;7'
    'NXy)V-VWT?mHTV<P+Q$VO%TuK{QRX^<aMHNJjq?MOGe7?2`o|dbGSrDVg8up5SN3#rNeIE|1e{p$N|CMY-v4HU1Mh2?!~OiOY`$CEXFaauZa09'
    '>GgGx&j!C(;4i}-Ye(Nf-'
    'KM4${kH>i4&%`rj{6t??{&QAfpC6a(XQ0@!2iv&$b7onNuLeEw#)GR1nw2FFnU4}{wR%}r5|Zh`&1%juJ|`Or`wf2dS-sJuI2RDzZk45;90U)#'
    '8=1j4V6z8b$Q~yaFmaX>xPZlYmIh|Yq?Q>Xw+mH`EtPXTtmk`MKku#^^V|A^n_*~4Cjsqz96C}%o+3h?W<lh3SR_%<BTy&R{Sjf+?w7|{cn=%l'
    '8G+a@2>ksaqZREkON9Ki_Z>N#n!k-#WcAlOV?)ydRh9`_&M)t<|*-JP*dFx_gLFWuLQ#KkimKQ%w*OK&jK#gM;xaer=M6Ca~+qO2gR84m3xtq?'
    '2D`Zr=lktX`N5TJ}u-*vrS31Sy#<I(S30ddt@JRqVD&PF>{`rjLLb+X3+;+Xh>ldZD$zrLglb(TVCp9FiVen!N@$4{XpWls>bRr==orrwdx0zt'
    '~8h0?>3a4;_MF&a<M|ac5+kQH<5UM!@UB1e_>!}wfy)jzjLi~%XMF3^x{Ad8^i^jIC`E}gZ^&ezC*}|wSY?=jeO*AuK}Sk^ePS4+~dyRqYm{7;'
    '`78DuYlHChK@J#2SuJ}dt7`<JhSHYpx2PfO_G`l1DD+?oay^!_p0`d@SjC?k+tC*emZ;1#1UCATKK%im?G#=4IdxjIp4llyeK`@vBnwqk%Ih_G'
    'i&fXguTpZ1kK;6nTMXT8PFTYHEOPWU+h%(a+bVlOZtuIo}+5!QaQe`keg@n3;Z^)dqe#&36s$8=?qctktW;1Q}w{QZ!!0G#9i?W)F2n`?x2qLZ'
    'fK+a4E1J-lA7^Q<=P#^)4E5W*mW}_Kh*4VVEE1@=O6w2OL5%?n`MLQFU@{U?)^e{4mr@aN8-~^^+i6mcJ<65OZ>WsWwD%7JS4J7@-{eL0=dzMv'
    'KxbQRrt1J_(j8gLA3u($5BHu@?dU+U+2CzdOTz+A$yAJ0Z9jVGo$C2-%FR{A`SM9Z2X?r@bRkJu27zjKTlU-v>cx)$68$UOO%{f?W+&f)VXoaK'
    '|k21zYo<f>o`_*NGEl{|I#BfxcmJ<&9C;6ZVvs7T-&bZBN;uzeY<jS*i$unrqfZ}ocrAF(g}xYhwdYDm#kzyudDmkraT!~<%eMiXO|zgsS4Kuy'
    'zYfZ9gFL*h>qMaFDxrTPq;9jkzK9MdL`#nQ#HOpt*OM2aNe)W<N402_G!v}0baP5zu3UIAE}Qw<XJb1njOf5^oD%{?284TcoH)hhvItD!%XFn9'
    'n`9e4&lC3SryMb=*btxu?p`w+@BnG%(WM=xBR*aOTQ0wA&4hH9?NGo=jRtCE=uQ-s}^hAn|m}ddjjb`6`+Tfs-x3&ijVLIM8>j>S{h$B26dGFY'
    '!RvD_2qVv`@4naD;v61uwy81;Ghm6+=HYmer&%_EZYNn?f2BP?7N}*0*Nb_@iKG%YmoO*97@iH>RXxXTA(}0XQwr(8W3k*PY4#NuDc!dv`@uI4'
    'mLx%$;K>q_?_9ejX7Ecm$4J~fOsg4yZdRZIxBgVNhQ{uRmYVX>Vog%mF6@~KToUs+_>^Enp7vXILY03W$*WrPgL{W-P42Z5iK_DY_4V76|+~L?'
    '{jlyE-&y@P`i?aZcN4+WK#^XQonC=?~w}O_lop2k=YX4=ML_e`#KUWc8A=nSI^ZXyQC|*%^VZ$&(kaEO}Jt_UoqxqAIv%TYkaHw`m8b;T0DQ=@'
    '0DR0btIwul@0e4M@^&O*IAu4>3qh`JVS$Z0x)Gp+uxY)?&pJZKmD2+*Ac&()YC0xK1m&Q{WAYe$KGbuq~F&=<~Mn6oNND4KNwSVIR*xl{;PhkH'
    'KJ9HsiO}f$uG8{AXnito)QMOcvf^MSD17_I3^hCiyZVtwK=cXQ9WDy`NWcY%)PofE`1O?Gy6H~oS`uG4ElDOu}NUSe@MTx<zVzY>;2DU`7-~{|'
    'NhVO_GMVi6sNvIpU}^<QH&Jt{%QPqBf)*kFR~`0nwR4!zII~eeQ{fv+^;IlVgLxn+s9(&eq2J6T|5g-fG3M^)3JwzY7$oa%WSgtG|7(3_i8-^9'
    '{Ky@%BBQ`F|TZl;%)!$&_HXjEB;k1Eb(6YT`BD+H6U<5Hb0~P=Jh1L|1`cI``};JtUl+WXOExJsnFl0KV`=1Gx;0}<oNfrXSd*Ood&%xQ&P=R2'
    '4nMYzBY{a(BBW@qY*dBqJ7FenC}VJDamjIh{mDsW3O8--Y4UL&&o^okx0^QShG%N8Lt*%)8f#0ZXxy<xt6&BlIc0^&{|3|{A+w-?f&!AuH1=y9'
    't><E10{EKrUGngF9&NWl>$b-@x9HC8mnA=hsM4F8sMQjcf20L0NZlY8<pFR`@HYQzBXzX?p=h6F~CH?$IqjK<-ysQ4Z42Wxk$ps=og=b(PT6x4'
    'n%4EbwH2ut{5qLPvo3#7EoLsp4~til<xXtKELPo{(kjDpxp7SPt{31Rmv2N=cZHPb1hxb1nrltO$xhyG2Q6F5dVaAn2qLs84b^s1EKY6&x2(Ao'
    'Q;S4X!VQf^h7hipSK?W`=Prk8HrK!oZK>eehRev%}vL}!+VzGl-7|vI4j?e<O>p6vXP$|NiA+w&hW%DF3YHcwezsDee`GA(IibBkFdufpB-'
    'Tn!J^S;ky|<lw7__6MegMkt@!Wgm~=kNL09O6vf5ylf)O8Mr!UbE;n3wE-g-Q^`*Dkh@w5(j)1bYXZjfrOzqCDkeptSgbQ8{!^Xqs`ufcB)`m1'
    'qGqg{I^8Ccm}l7T_O{%!9BjTOv$sq9PF-b<64@n2fY3_}cUG&?vx6LD}MsE#w)UW0Y(F#IpjK~N-eynhbLwk@lV`+CTp+b1UhIF0W=YrLz8gfB'
    'Ffp}(!ve%OXG`7&CD+kstjupb$U5hHtge3rIOJXa;8j?di7;b%%V`OnLRbXJfYj-+#v#oUxEkHNci=6N^}tDgM5aW_*=!nw7)TijI6oh-<>gtv'
    'Hb^Y_ab@Y56pC2ou{$pL+T4|eF0%sa;Fqu7n@^@ku)>DKl-=*24iGwxR>DqWJ9xgDKFGD43nctAzu_vybeoTFVntK#mn@@b{&N{)s9{%~zdUNt'
    '&s(28@se?2RYXZDB-oWEZuqd>Hxl9!I(=gZ2FTpk<2G~9Ln#9f~{_k-W-WU||0vKl+VQ@a*|EaCGp`B)X*hWLvyX-Ezhj`{I+7-TgncNQ+w^Mo'
    ')!!y+tlzpPHGmoUKOB)`5dEt_)U$LRUH=<8T_8i@xt)^jSM?%zp2fzHXQ0b>{B2!<eaJJSfA=b`Cr^!E`zC@9~3rZ_3@5Oj6+<(OcI@EIJgQR~'
    'y-`3Lyzz(z2VkZqMz`#bFE{@k8YTTQohDek;PJCYFDIM$&(pAV0|e=<%}<D};|^ZE9?FDa1CKUoi_QK;Qdl$uVb_M^1-J+{N*ST6>DukZKJhk-'
    'z=G)M88QW#LYNFxW&7zO(#KEEw)Y#7aY{+%|#%t90V<q19Op`qRJU2EO+x^a*2yVe7Kfpg^Nexm0wFS8vAImgB0N4$YG2ZP`SyU6dai53z_EQr'
    'R2yl-!isE&}#<3vA$^_*Y)It=fjQ#+5tk>pZu-`&#IijYgWJJbGudblW?_GpqPiK~}n6B5Qax#hgyNEcQ7R9&R7%fX!-tWDbhC0~|4+@He?5k('
    '-8XEf^1y)V3`+_7wq*uyEFKKkzQ`mcE2j1$_&NAzpRaD^Gq?H$d<NXB_vl7o39f+9JkpHC&Z7%Rs`OYdh_Ub4ZjwZ(m!;)2%GpI?y!aqdo-?#='
    'VboY>bJ?mpx{IgLdw`BQ@RadY`7xyJGn!$&sHQYd@8?_A`2-(Y9_V%!nvw3BlA2t&-P3D{ZO9B_O>#vS}Vq8M%boqTmu|3JMnBD>9wMZ`3I+`f'
    'apjK(ceFq+|KCyb=Nv-;zpnCK??N`67owZ5ZE_z1;WQO}xjbJ&>3K6mS8V(~Kc#(CS+bI`<O9=%s7MyW}hA@9w5=by#Nt(VuP2W)cT*Mw+NF!l'
    'Jd4gC+u-3Stae{r4wnyb}0q5p(G;e=gwkmq+z?5m-YK_mBi!anz#0inqDJWV6n)gwE|ZzB9o?+FTAF3Jov5ox#1=I~&M+u8FsX#T+O@I88k2mT'
    'z&{6l$l=(j{8hKS#*<{O84%AWCX<Kx)B1)uc=emu6dRYAjv&qr>|j>}N6Q!zN*aG-dRUXJ{=LD9?j?7iJMt|NuAx6Ykac}e#9985!2$Ij{_Js|'
    'k9-i#O^oV}#$xUu3ba~I%4=-BYRzL0#Jt~wo(lMmhf#T)|N*zq3`3sXhf*<Y<Qf`$jbSda3s_C6ZgXMcVEA^XcX|LPa#{+Z1=BXtUj(__c68s#'
    'JE&svfGEpF)Y7N60~D0YwZJDjLBFtPsmTuUkXe>WfdC4cC(e$nH6l9PUetNjmG`XR2h5ia`&B79HTNSi-`cJN)q{HEMk_~iLqqD}u<Qe=AaOb`'
    'on(v8-39K9B~d%Kk+Rgmg5$HnO9<YI5x--Y<@JKpVE<GyEoF_+^*Z}KB$8NZ@1o&7TB{8xnIB*!dwX0M)?Ywe25Gqmy4JpXx6fO~@eLo)5sS<T'
    'P+Re!C&Of}dkIY;rO2%e0l!BDLJ#4|#L&o$u3I1kTUpY+v5<d8)AioVBZ^fPlCA~5x#4e{KrE*Z;?Phi~fNxXR$`yJU)!SK27%iE5?FGsnMssT'
    '=fEoe5%KKx7#*t)r$RFlDAx6XZ&I85W8k@FFp-8;piF8EHb^`S<}oGW7$r?A<T811bx_Dy>4^(}f&;qEWM&*%33W*^k0b*llLHt_j5Z1rYe-Y?'
    'TjB5Pu3I9$BE=cBU<$(QevGv6D3{hoZ`(=tD>Z*H0==fT%^cP95E0+-IY5z68@8_1K8Z}Hvh8P3XLG|BOJP*8NvEH?!|=R*z0sDeEzY+;`H!Tp'
    'EwW6*%y{OmZ6g+_?C&ewip4*aEfKr4~P(AA%sx5n=r-!|V`H@0~%-H8U7&3N~ut@=he+(ZMpx5)jI&o}9b8`EDY(+}<4x8@Cg7lszvJ;bx!j@y'
    ')mdPli)(pc`s`R6SRHOU5bledmB>$*szp7gxm{GoO>m)y52F2+f7iNVf7UfBW-lHEydRcT!Esmf5k77tUhYu!`v*f+<WlN<3F+jqaNE>Sm3yxt'
    '#q(9r3;?^O+1d#6}x(1i4To*xV{e4pp*=5Oy4o1F&@=znosLdU#=fwaFkK7m@rUYjtY-$?9z=)X_r?q($>`#aS6N66*Fcs~!~i12wt%gLjBsuc'
    'TVoX(LyMGr<8N9Dit6UCGMmxy<$!7+zxcZgr@zm9Xpj`-v|dmCJgp)X1A#8jMI{7$#^0p(<H@jp9OK8SNu*@%4mo7pi3_h-ktyYJ^aZr0w;Dg3'
    '~LMOM;uzj$T7?e<2tNNV|pTJp0wWoo!d<hstr9j4Vry_IX#qjUQ4SvJyl?zxSIUC%{+Hm&EHUUUsXD`uyg(J{t{W;R!9Mz6zedevO5b(k}qcF$'
    'uKU#|b+o;lJekaXt$jLx`Kj{1q1#M|`iNxSTXU(}%eH3q^)_^eWIxw}C=wd}R4$zP0f(3GAVmw!i|L9K3=s>CC$dMn!JT+iB1jh3CgkaO@|Jt0'
    '(c=Aci?__WME*t6y4E8}yr@6eV-&B;;xM>l34U*O5(I1TdI=-f~A=Lyrrq3uj-C)=>yy0t&iBmGR+u<G?X>6_cmsH;Nn%F}fTKd0YX9}QMB7wz'
    '`#1-{+)WH{U<OtG(=x1~Ka|HYu0OFn?7vsgg}o1CbFG4?e)tNZ(j>O$&_2v>P(SjvTURqwCcUyJU{<{_~c&+PR#=@EAdU;irFM!&7a86Lis{U6'
    'v&s;PVJpTXPbbCWLUv6Hz-9_g=G@{1k2JCDo0tFHp&xJ5iC^-d>b)gjLEhf|%d`#I8gY5?=G&Wq&v)Ad9(I^z~U>(|+%m+0@{y~wGkFQBh(+ov'
    'KJj#87sXuq-!`+WaX9<=#$`jruF$RLf~|2s9RTn`>8b8_qFR%#Yqr+y;0AiAI1KWV?x2kR!Wgz5`n<)7M555qPGQ+w_Fy!T0-#5?K5EBY3~*5D'
    '@kH?GI<+_7b1rhR38EoQoHUC4LgHv8B2F{gDbZ^B3DXOVyPZuBhgxlnKR^4VRr+5LHEbECdg(gXd-'
    'PyeC@M$M0HZO*M;UJ=jc0hcYpWP^G1XHmT%4gNo@tB7+il38TE-jDRVv<9>7G5+h+m(lwS?)tX=1b^Vrt#Q%uaL~8o{dBZXxA-'
    'RCs~%wb=Jy}>Od0xlM%U?J@Er!G%%2+<Yxm-aogfx<!KbnLQNIZKzMvP<$z0c~{RY<PIg0^0*5&8aE<FcBwd*n*w}oNX_K5Bc@x05mx|92h`>m'
    '+~xIg5-k#zzKU0#z6);-&+z1z8er@CpQ_jlu+axdDi3)MgALS6PMb)KGIF-)Co+N<M#V|P+pS1$NIa7QGY&iCdvb9d(5Sb1`u_b@2jiF>5GFc`'
    '_Z>9b{M8sSRo$Ijt9`|q!vnKyTNU{qB9edrd?im3aJLAI0alZ^0<Z;tELSzgFc>Rs`)EEz}fZ*EO%K(9Bi*1<rloD90{MD&E~j2^i5FLB~C3^$'
    'K>|KMB?{l@WUy*3ZJJoeS(bL;-h-kqLjfWgew5X~RWBS7ztHeoi*2s(`+&_{rKlo{{3X|7%qLkMr4pC>)Jf17?#m+YZ8*+t)JA6=}CyUJdAn{D'
    'tT@!E5>8#5UKc<ou9%o)BeclfRKH*c-OxzxM%yL*RSt`WY}Q|XB2&h=wFes16+Twd6d*101G18|RekDRFg!BF_jRnJz#vakBvnGA!z>TlQRyM3'
    'xQ^=ysm<@zRHNAg^P^R)Sv84;0nRKd)M`!h6fs-D`QkJ+1P_)H#EWKDaJSM?+3I?JuPz%1>Qbp>x;)tmCId?)w=Hd|@`*89CE)7~cAzFW3jril'
    'wZncvJ0z&7F!c>BFws^NcQE&q4)Yq*j&F4V4FQ6F;Ed0tfmcxG0{(et8uRvqibNZ(qtEV=MEqds9=Ct+id_2s_>W<>t){Nms4$W{|uW?nf>|GB'
    'eg`yKr%ui&X`c<D^-DbF|ih5by<;_0{I>g(oLy*qx=^!(HG-jB%7nSCwRyDml+MV~>;?Dg!qp48uGb;|iz!5P}P!1H?*pS<S$PM%%o9Ibp$Z;V'
    '^@f2qA(bH>-5t!dAm=tZJ!^pide|4d3e9DT4WUXoeAd;bwRv(ByS!%26ehfBftz1@0__lfw<t$fYwH+vT!^B`_79i6-T&izvR@l@=hA9tLxX-z'
    'wN$7^@@dEL*aCf)XSgBjt2SqnK;h-t34$7kGG_7m>DoIrk5Zb^5)f*-LQ57&s24YLH^blbUQ8TRwe0(L>q9<PiT!le6Jc_`lDInZ@Zhv+C{#Vh'
    'A?i3oe;$iB8O)~wPqE$7E`yb%kW_1ed|*M0a8$7k;K#Js-NEVViAYih6A574gNItIEt-=pEX;-AQA-#!20p2J*U)cLvn1ytXKoAwuQaF>O&%wv'
    'k%=zV3K=y7)Y8m}4AP5u>i1m9Zc=E{9f9@*s{d}Gp|h_|u*<DAAfW3nl>ZehCW#>w^}`EdsKn|2q;pw#raVZA~Ik!)U^#fh^d@ujsN<Pig_OTY'
    'UlTREbi->;odq2$wz^vHMBzjkcW(_UmPiRRP8Tye-4l3`O7uYVwYb(}jJMV}Ep#~ji%W?kV;dO2|1^7eBC)mi0E^lo@-Zmq~-J4(*qupa(5#aY'
    '38-PTXl6HV1KhUiV=wY%HSQUj)bzdhZ&U+t`)D6OuIiCqyNxFRlavcKxyY1?m)b-t;OT2LSN!+lCwcG>6smNTA}vLGxTJ0BY=Ax~&c*nNHec_e'
    'dGJ_vaJoWG+xx2Fzd<Slxj&Z=ZrR0$*7|CYXgZ|Zl8-UUv({_o!VEqy(h6*G&C&+_>R9}r=U80taK^aTvj;)!>_CL`R=eYk(659kK{vrf)`3gL'
    '^B*z*e8*wn>`xxoWqz+2-tW4^%P_H!_{$Y1)7yx*zQ=|<0m%%_%4o^(g%O?kL{KPUC?d(9cNFssSlseFXn_S=iUPM;obmOuJkb^UAuW+G>#Eh6'
    '&bHvN3<u9A5_`qg!YH@8L3@yM<6Y2%Vh_`A$jfPeBryzU2c%&zU@{Qvwcgq@xp_^$IRPtOFr#+Q;adzQaH=BbVbQ8hUcwZ@mu^u*`h+5P-p^Do'
    'VQ_WQ`*`L~XFO_LjUW-o~*Pt2+NVc&arPwx{u()#Q}AAIP8f7WcAxP@F?vbhK=Xa6DdkIv@{{oq}{pTA*nF5Yu9U)ZJDUEevw>r|}d)PB$EiDO'
    '>>fjKv;K|V+FxBjJ{ub=ZB{5E>HdV|>n2X@9`Ke46rFx>tW{meDNsaZ46e#_nMdyM^aW=@)C{$72U5SMd0wRi8s{7&ni69%vbg`Yg5pnx3x?)V'
    'qr;S=)B#FVY^sXIP7GxI2BE3=PoJ-fZxw&9zeyn`<fJsj6Wmy;UH?^lnoK!Ir^r*fRKx!BXiel1C>-!4VPtq$W=5ufMog3q&O^SaPyx=(xQ#)2'
    '8rb(#HAB|1&J4;OQC2>)5*Yx>GWd_H>4N9WKU_wcsoL_5h^J2^owd-M#)4Cq>?cCl|iYPq_zD{@;h$DemQqv$%E;~xI#4LEsjp%#C%8BDF+VEX'
    'Is`TP2g(>b-1#5>gof6jDE_%C$c$9ZZezt`-Pc2VCsd!HBn)_>-0`*xF!UA6j!qh1d`?iWp@m%S5u?QGn3R`=Y<xOM3Ter?2^-ZuM|czos{pJ~'
    '_ad~fgRY-GHlHhxo_;b-_ACTIFC{PSw317F-*XLg>n=e~Q!_r)4&HTN;|b{p)RZ|9<osj$vD-^r!<M`!wB|M)Dti!~h=>SnH*k#xSM<ZU?;7Ux'
    'QL6O~_drosEatFG_DJ1_S)zf@Nk?w53V)}qFHQcw5G@-EK$D&Oj}Jg{%F7kWE<uW#!I?bSEevdwbHqr0X)>}-$EtLLBHqUJ0LvtF#Pjlzn<i{J'
    'Tr#dF`j*AqF)SNP#B`+2Xf-A@odtqJRW)S_Q;-e>9HDnDq1{1{)wn-}WiUBYKcZ;<#c>z03}pZSE(C8P&1v-%=NI2T8O&8K=5{B!CTkNewA2D8'
    's^@GnN=ljELbdKQ3<UiBl$xZflm8B@K_-)eKbDUL|@YhC@0)Bcca{UTTRN8V?Kw5#SpTsVhc$scz&sPC0r#iRJj#ol;9j^A<4o3_=DYB{=z(&o'
    '5l-Z8)3dUi}7@v`@*GoIN@2k6gtxo7u3#y4?|-{@_%2+@9|)BdFI&G}-V-uZls@3!|(*B)$0zI)w-;LH>GmOtq4dLJ2fk&jJmlCYO2ZOl_=a6D'
    'tojq)eH#fN(uLml=Ox)cj}#d=Ti<++}4<686#yv&>Yv+rIThu*=t-Sa#3y6vG)T^@5p=sj8XJ+20Y%e|8;+w(J*+}NS~N$UE}x8Boh1g-7f(jy'
    'zsM&5QeR`=Ygi#e1R`p>4>_w?hv;X`_3c@%SGeRWi$V%D>sqJ@Lsj~3iJYUUvxlSaN#zmtyWLwojK4*!-g9qJ0IS*PO^u!kGRZt~GHoPRh!Qp<'
    '#sv63IpOSsV2<W@aGl>B|Sc*ytYuOIDo@RR08cjq?A<T~a_c>|7VOJ6?!y+1kU<9rO|&AA`PJ(rQwnY(EX_;=OKn7nr!KXf6dd^~#eIp<5eM|s'
    '*2G;<)UN>;D^I>lTt`VaU)_|nt!yXyOhnH#WcVlDJ&zj0sbTKsj?ll<CS%C&c%d4G2H=B?tp-gCaXbURhdaeF}iY51PrDUWRS`^=Gdpj$c%FCt'
    '&#+&sFA=XyMkiR49A`uE({4!765)?3d~pH)e=d8_y8mF4^do#dGF>wn>l>|V#g+?Hy$ouu=z_nHp=*>jfE{lAefOgcX`!?D@Uk$!Q|e^u`0);U'
    'Tt_le^kH?IYX&VRZUUwq{JeB}JRJ?CeJ-ug$m^|z^|Jn_yR_aSM0htDunpYqn)RAA1=uklwdEGO@xE`0B{Ut{m(r#!uP$09zsx{pqGmfH05_UM'
    'ggZ1v|=YfwmU2J=%szPI<lKSe`sg1$F%vrZ?y>?gbxFylM#Z_-adzUJmmE6C-()jMzNV^(!7r+Vt@UTNbCGGTn4f3M}W6My%&+pf<Y`+}bv7<+'
    'E-ozwC6L%KWh9Ct@pU|!GL+kQTkjGX;!_)ZCn>@cS{s4-~$8|u1P{v6NGx+->fQ@gt^{jY9c8*(bHcq_X=+kEeYulo7i;=N|&x$Pv|PVa_4-yP'
    'qc!sa*h6>C1Qc@DDYzEhu-{wx)Dh!>yV`8|+h#GjMzh~<o1*<7;~iG@q~TFa|M>Ict$YQ&OX?AYBKXQSGj=j5J@+n?y&7}S}aqn)+WMl8vT<6g'
    'Bs`Ds0S3)~ZE=60&|@5;}4Z<M~v<|bqtZrxM;xUcK$c&4A@(Yc3p^Ur^OoO?hKe+{M{>v28@HTUOt@G+k2QGUw**i}C5h`S)1y&a#F+v6jil(}'
    'oj<sF}{SN3xc#usJW0gayOe*;<17~6`9x%OxF9B~PfZ4KYHIqG8!+@U|Ge;>X30)LE;b*I}&Z~KW7(Pcf|jT0s+M8%4+CvQgQv1_zBZ<B2k6~B'
    'ECpH;3;@1#9!kMPtiwRWQVfS>i<oXmT?ZVutRIzi53_nP^Sr{+7K>ATcTc!ZJ8`gB6GX}cYFUv8I1gE(}A6|ZJuuMs&ir+Per_lb6MOJn}XHSd'
    'jGY0s_5hD6-{{0!gY8Qp$Pu+y+4?;EoiB61%i?dREQady65Xl5|Uzd6xE0rt>##l0f0JU^aSPxR{+rl;Q(jSEYNBf6M5d+na)>Ctohb<;i9`zQ'
    'KcRm{J>*w;NGmVUVhSZUvlBabo{+;0?SnpKk|vrpxipQ6L-=xKcV{x98G<XZB%B*~hQbKLjx=zQLsV|H-HXKT(+`iHN|%_hBCeL-#hJMs18xm{'
    'hJpVJ%S=aI`ZSO|}_tNU`N8!I=n<LiAwxO2{5dYc@1s9h;9RGz-|Hkr=<R(`T_Tk6$mZ&%CT3-e?{az1LV!1+CSQ|M))&*bT|inci#29I2MN84'
    '`4TlV9*>095`I=8RO`I(pfg%SGtg5JHJ2FKUY(wV!Dde_3x4d>7LFgNu0eBSJ<3!m{>JMQ#s=d0pZ5xV21JRRtq>v%alFUp<NR#)SVxiK>;_dd'
    '9=ulxXSl;=iGackvpUzU5?+tspH=9FG1<BxKxu6&0{?<e;Z?fWuh+_jiD(C=@1mvxk9`5~`9<kg3~`hDe<%o1q8&dja<Wj0^!)SfQJ<u2C@N7)'
    'wVZG`dlG<YQ~oxc0=1uQ&1f6j+K{o}ahTk9$h&iKPO_2HYk+BfCrO#QoTKAoTOA)h|v(}#Tejpb7~ujXH8@15V<hyVP;fBxY=|6Tm&Mm)dV@#F'
    'RXE?gCrv+#kjJ}}k?#`=9R)=bZEnyv<Cc=|W?RXw5ZpkJsbKV;U2%=(a7{|dhq&$TJHUp>@?4aWbzoP~besW_<b=@dU~!w=i=!#4cAZ9`o*_HV'
    'NXPw(p^SK%X9;Uib!cga-<^|JbR`PoA?tsipgLr#6jsoz&l`F-L3RWd5(kez1#^^v3gA)h|v)9;R>a!bVjbdR=w8<q<7&HV7AfB4Zq{OG@N>`('
    'QX{CCCs9#jvY4=nY8r9QCK?~A4Uek=bj4CVKX{*X@}^65i9{nqu!K|j5JTW)%{T_+rA?>}ODA9CtLPW{$$Y95|v^{=q;3a9q;;eY!1{wHIm%2A'
    ')<X1lsYp2#3iv>(6y{IjcM)hWI{o<Dd_HoeXFboA^CIX!RUsiQuf(qrKI=N{MZAN4=YS#+jJo*6a$$um<LCuan{PcLEg<a?(XP_EqjBzo=dHrM'
    'V8$&)!|gY~o37q^}Kb|@<^&mukB7nbBz?)~<3^EoEYW-yDLomp{R|KKb72w$92QuUm6?b@~YJoT2@4*i531HQO0)BIfT>QJ8S>Dd9QS8M@2V7&'
    '?J<dbKHz1!<vJh^eB^`L=4k{&&e=(lt{7c{(wG0#Bg)W*?&6YiOP>D);6Zw3i_2c3SBHm|1fD{1}QJgi~#8J$@F1s=XQp940D=Vbrgd%xwJ5ND'
    'R!^-s~K;`0+{O?bbKIL|45Ii$rCb2fn0>}jK2-~ZaV)i;=}aS3yutV1|sm(OKJ=)vDhUnU!$seaN|&m^`+gQIzzs41&+P3%$6>q2SNjkj(xa}f'
    'XkT3e(t!~gSt{`0^7^Ji=M{B8N?--AE@$9oy{yg!$t-nZvJ2QTjP>mS>fZ_}^d%Xazaw`cmyTh7L-(VxBT@{fLRIUdme#@={7T=%>`zV(KGe0%'
    'nud&}oP;<5N&RxJMcPxpB_9?t*7XPfvR{g?IJeRlu+cK7G<dDfe+#)Cf=-(FTPgBS0AX6}Ff_kW7Jbe?efUrzgOIEdS;E^uzUGQ>H$`4rLlc1U'
    '*ny3)9RX-$f&`s9B1SbKRa?kdC9KD#dFj9v(h^d58o8<gz*C7lD&=)&ud(_^O%J>D9U%vtvmmB)-{@9FPh>oOj33zfB|qw;LACwprMJOo|M=RB'
    '_r>tbs!!|&V<rRJtP?83&%;u+O%<xDz3yz)}apSFp<wB??Pc^kd*lP=jKw8nKYyJ$9Jcf*!iPq7f{13iS@(v7e7Ma*Vxq}Rx)7$mBr!F)=4CLN'
    'hc@7=aTYp*U~HxO?I=d$BHYd)rDl+eFCLC+%F>@%H@Eto0qtp^3NEqAnzpdM)G$XUr=3)Kl^K(XN4#oTXwu*00))(|#NkMy?W2GhF=E}i9QLHF'
    'Tx+r&G0shxP*r6pEP&!scpcN3*Wm%b01)ggV+pRr$I`5fLW*06VhwemT#5pBN1Vm`eY6qJn0GKSxGGxWU<+0l3}=0O&aW0PC<GdN4_OM%>=?~c'
    '>emRB6o8a&)vd7RE+jt9Ma+fP&%JjbGue(829!!HxE+teQDzCHDKD(-&&-!ILqoY%v0=(KZ_UM3Cto)XsCVEsgI#J6%z+?%rPt?BL-I6pdD53_'
    'd}7wL1(=VJYM4CgZG7wjqPx;*xgo`z;|6>=8Qn#^99)0t$Gn<C~wBx)<BfA}ePX*#plg^RPA4Tx?mqCHpsP3O~Zr{Z`%=$O|2%>ibe4Tk+h5%f'
    '3e%ij*W=*tiM)+VgUa`bLkJNljMsb65<aFXc#ZUCA|ke<t=$Mm@|Ke07bKCNNDP4a+c`e-qrGwjbk)9+G*DYx{0!VY9#Vg>}Qo#<^j?D}V)#vJ'
    'P{_DA<T?&n+U%y0pEne_6hT`Nv>9lxiwmvFZ9t`hOFMY8l2Yg@Z*oJB4MdZ%;b8KN@tfaFKQp3%8ZdOX95_^MOigGQL1>CWhP%U-9-JV5emMLK'
    '8o1+xI?`Gc{w>JwdI|CotW%;l_pg6=o3{1=7Fr(yv!oKr-{mPPk9?9EaOMf>1^QIGb{v`qBFw3VTAoz((bBHHTH9W*=kl4zCg0rWMp`ZLH2Yed'
    'iayHEG;=4r15=x_(`r}fEtPtdzQS6>hF{%Eg68+-acon1@ICEO{ksro{DZ4$m7(jCrt-=x#}oMSQ|xm{26cep3A?di-}57T)PFYSm1R>Z&9GwE'
    '5P#Y_tR{z-3__JX;GkX`oP&EtN(J@HnoNBmJN)L&@5(9?V2>8+-x4WCWNmt7vqF`<EAP72eRo^b(v5%jH~Jrm#KyoBcmd#m4R$oUiP`D^F*L3R'
    '=Sgy&`CpjWhvUhwP)o|~37@J*WMB|+}m`H=@2r}Lxlh+c6z;J+NpF!6b9@s2otPuOP({_hv2%qP9JlO)*+n-1qYJ)(8+U_Q4Xna6ve=OjY!!P('
    '@KghhFcfeu9s8na1gjZHmggmfw25zAw)kHf6>J!lN_sz*Qf)!xc+-1+O~nfR<fuMJ(c0d1uphQogRb^7#h|0&pGdP{2=4f3O%%tK>2z3<ZZ51t'
    '=$xh}85JVNqZba27lVAcuI-G<iA`j4KM1WxJ_k12WP;mqru5p>4#xj7t?uENZkeK9kdkdCw*I%~tny;S?O+<a>Z9ZfVoa^m#we0>DEl(q8x#N2'
    'plCvq3E%ia&-xw(?BjNR0XlKms$3AO*!Q^w@M&pW=0crMlh4HnYSXEDUVfI)C~Rr*df{GHd+-@)CHJWUY4&|S;j3$4*PJZ8p~NikR1kvz!oU1y'
    'GXb=ze+sWDa~{PUQZI-7yk?ck@lr`{|6z;ayphIH19<#r$saAqFQ^TB+fPL(kr^rDMrlYXY>!k^37gzsPbs4`(*e;hAF4g}aw$u4&<`qSD!j$i'
    '0~Iqb>EmrLW`E#NCX_lNnHu!uwVrf`?Y(L$Z{Da$XC|Dbcs(<3>9_&|KP#OH)tS3D!Ak?znlzI9o*4T&yEMkZ{=gP;v3k&cy{-PItTT9!%AIq@'
    'N5TIgT;E@6Tsuw)$Tf$n8FPkcqcBbphoEFhc$Ou@8f&MYd^-}YzD!bxcQx*IlHb$pl3l=x21Co2FelTPMZCz2C%HiLu<>_ERyfnIi|T!4=V*if'
    'CJmi5qsHLQ&>NM3x0bXR+s+e3T?%qC}8f}BMjB`^=&mDSI01@q&a1j{SEMt2AMD4&`+bC%hJXY3KqQtO)m<6C>L^(y2ac$au`)Nd1>pnLD?=LL'
    '2JowM#?NwN!iHxcLqht91V_e4JBKdW~w!MpSv;)nfm*dy8(9K!OP^h6yPZ-aMZO-dio_w75EWk+(x=hya#{~3c3?dFywrx%Dp(7jj#`g_KGZ54'
    'CgrN8xOsRYp|=6(*lBHP$*#j_cYwW|}J6P0)QUNz29*xlD(n*NpDVCtL~hh@F+FY;PxT}(ryKQwlh8BFSI`;Byr=--H;Z+R_xerb95@>mzl8<r'
    'dS1B^xcImA?Y))V7fx{I#d`w%u3-z)8-+_r#c??}!Z-XX9BFu)Y`*#pe-oOzHB6PDNW`i|u5lJzBYIAKJGF~KYAWs-v{vLBL~e$DqkK5SE!Ny~'
    'a{1T;<eaz}R7hIBsk(}L{^IwR0}qg8{P*%z~37BUMu*S8A`b?>=QgS|6_&Z1|Gg!fXo*R{4IK^M@2u>DAuJ!l++eQ;dMzca>cWcQUwCh>dORv;'
    'M)+j7LT1KgvrXF;$ht&8pyy0?m0*qYA?IK4w>HCYa24q*uQ>31<+Ean%Rp28eFYpV?mQd94WuuX6Wv$}6nv+aZ4^{i8fUg=J-XW(juSLxkstCJ'
    'i8_Q<US-=*aIWgZ>$fKNAM(^{Yhe`atay>dISX`vU1X9Qc)daN;@FUb~#8}<1y4fQ}5q&q;r#3StU##t&`k!-n@Cw2|!EID$;mNV^1*#~eI{6Y'
    'n~JN8Q}%-C`0?6A+QZ`Y8V*+74@ttIOmiJe1oY{t6rMe~JVR>(*jc4|#wLpt;O&tIB2+uYvq@h<wFSX=jD8?QXvZ!6#zk^=+WEu9}d6LNuYC3p'
    'hzUN9`t>$;y{d<*@%qW3dKCD}*#tO`31=biNJ;Dq9r4C}6W6d!`uU=uoH*z-1U@=|Q_)DHSY>tW#~y?%R-nZUHqH0z3ljrn}Q0_tudzZB23X>E'
    'CHF_3eFK3<UAChS{d8Aba7o<zOPSlLG`+Z}nH-JGtTnwI-ij+5P-uhRJty=DY2k^MS?e}QcSqD9CLZ5Oj`y|aK#G_Ke56xPcm8*2^d%G8F=K--'
    'H7H~HtsG~#GHO7!o>KM!katv$?7B+QKSFunsjJI=O$UhG#zLpbX(upaz6By+Y7+b6=e!sGXUKh8iqFMn%2L3clL5{zLO12|&GulqaSZ$>r-<K8'
    '6jn~CYc*V^w@_V*%o>!3q-LFW!VL-Y^1hkdl@9Z9h_V2h+;xO2Qy`DiDM&G@^Jd)|y>8RGzXPR)NV=pt&LBJWc>@n5|z{e6zpS<=CxC+D@W-$B'
    '{<SQq4;qEnL5@bR+mg5(4Iu&mFGm@UyuJn0p)PP)<BZtPaF+?=L5&GCKe%Q&D5_%sY((-WO7owWx(ptEbOx^wtU7$b-Lqr&HD_|owAv_A21(=#'
    '53uJ(hSrETUZ(U;t#x*Nzfp81+6f%iz)@Ux)H32P-i#>J?EkiT0AMk5SQYwU{r+KDZj-23vOLztG%mU9$<k4g56Z^p;rV#_mrW1VG@{R=yiv1`'
    'C9IBUPZ3S(BR7ubn?v4tsoIdzu*jeyn}tN54;Ie#hrZ$H0-@G$H2M!U8NFckha4gV!{$cTM_fo<X2ID%UV|LK@A(U;O0{+v^`k=m9eJ_*(ZJHp'
    'BPr=7p9CVjSZgSF*E4>0D0TpZE4051`aU>aWodlKe>uf==Lv%g2<%1<G@QqaC6n=$1ecxQi*Ael9<{RLj=G?#iWYuLR5uNtHG$BKk)V8g0^Lzh'
    'qacM1oU3FFgeSnsFcUE(taHbCsh|JymRO<litWxnT$@V%3<SogH}^STS(Cpj0>J}>xw**_R(Jg8_K_@x@d-U7_G6*<AaOIviM@8ckS4Ihv8spk'
    'S(^X(1Y>pk$lE!qD@`=Rfb>ijco)Ftbnr_ATq%7k?%$s20{IYRfoqcwwvj_?+2Exji>qisl@V^7LAHK+Sx-^gP^`Fa^M-oHRT;A}|N?#ppsr!A'
    'g#3Ih>u^a&q9-?9&NoL0Ua*r>i<@Uf1PF*-LuY;5rQO!;D9v*%M5(_4XY=>q<}Zk+JOT-y<*Ee78*tx0?WJJ`cL*f@mM16iGdk9I@+wp6hV*tj'
    'E?bay{q_xj>HUk7movZ?2cGZ5?CLT_t*7h${1*ajjx=w*}-DxscZ&{KfRY{4`nXZvJxbL@p<7F*$0@i(b;r921uAM@IV<(tp9t)Sm!KFH02UYE'
    'EOY!KWdFiDQ&!3Z)X_FQ{;?9v*Xcy99C%7Onj15d>wh<={(_iEkntGYxdURv4KRXY2$`!E^;$2ssT%^i*#5#L#$>GC|ClsG}jd(4piL1*U7OPg'
    'mpS6aj5DNi&>a!>h|3|&&)liY+p|C@MsqWrzerY~-^Uzv0aFv?8Xc#Pr78DIuyF+hGCVaMm-d+NLi1JFAj$H@I78pv9W*7$B%$G@RZcc$N;eHv'
    '=tWJ}~d;-MtjcpS?c62|k6ee;GtA8V7D&})1q7*=@lQP##dE7GSgxB)yUHYD&(LeV4fmy*A1@05hL_`Q!LOX;0s;C95d2GF(b+?-^RvNv-}C(b'
    '(Yh3sYjdu5rg4B1UQV-c1v5&v58O8b84;|$mY?32Unbl8I<%r65SF%H5#7KyI<`MTiRxxy?yp1%XmC2VGcC#Imy$MNFH=?wmUB-=&Rmuh}8>EX'
    'fmiM0gNx72;tI<>p5!g5{1UaSSYRbXFR*4hoGOwS}g{ruHoHy_<Mt(y^FH|PicWx;-|TiKt{v`Y=hWk>FGt$mizx%j+4%dtOG=qhXC%ITpmN81'
    'g>TxEHHGhSM|X^QrA_o($tj%ELg(w7TmYik;TUTQx2@72D|!O?Raey+EEJbvGhZB+Q*^V_I+X9&v&HqVskAqD)gV0sSOoLj{!uY?yo;%j%;?WA'
    'AeU+8npr@F#jI<T2YR}REZQG2pVb?rlM2(ODDP1$CAp77Cg-O49*M~WvEK4<@AOJO$gl|#Of-YLP}>jM)PL>HG0|10p>V}7vsLgyrQF3HnzI!8'
    'ES*JX_D$02-Q9ca88*z6J)Av=V468i52GSI(o@d*fy2=eEFb1cI9zJFB5R-spWY`g38DjvuUl2^o2nl~PmkNdG{;XKBU(t&C(UO*ov4Uo;9`E1'
    'DP;BUaYWr;<<kbHvOwD{7@ZiJ4ao^_{l8x|Z>nB3D|y2{Q8ooTBFe-F!I;DX%VRel}9XG{2$T$bwruj+M)-<*A&A-{QlUQN(`KLv61G~}Q7e&C'
    'y#0SEE#b(~+@0Kl|-7b*s6`05cOVY_d{b`JaP>Xzy=CVSmyNzT7o@Bu`{)#Y!7!{;{S#F1TbSB|khB20&vjnd184ujmOAfA0i3^?>`j*Hh=Ryh'
    'xYp%Z7F8lv^eIEA}iSLyi;x+i6)v%kN}aRunG9L`|RzL>o4@7^EsO?AIido4n5!cT&pK+50dvhR}UYX`d>wF~fDvpzoH5zq#F41!71XZEDewB}'
    '=hN@L6CRh~dsB|Ydo@kjZ(foMJU-%9557JSoe=V&dT#h*@?RdgQF$U`?4iXCO^IU6?Fq_PYBUhu;U^dRC9W%e^ymu_3u%KMG8UjcrxmBjK|@Yh'
    'GY*N+?A1@8mqOf4P3!a+=}!<aXSspXZQUdImdNwzI~Uu*o;a+F_}eWb+e{l<acT&)TADBUY^7ZB_DWXA4Hy^jCH&rW>Jet+bUrI1$#jIt|chIa'
    '-wSkM_XoHo~WiF^xqcY+wDj)enPajXY)LGN&oS5`=ie=CStOeC&(H*AVO6fugq#Ggoilg;qlFl-Rq)4sMn$U&mLKp$=Y`=xQ0tYo$!-v;RD%Op'
    'm04Zc)99(8}3-qh!x$R@iB$2iF*n8R1NU4D5$evZnqGJa3?TVjBmjNPGcIyWI4x+QxEK6v~c>d1rK0Qe^3wD&@N#IriYmfA^tozKRPkqh1D2>T'
    'Hajqe^av-G%&_)so2a)AdE#kJpO*-jDPyI-*fr+shOb0w?Se${?-!2*U)(Sfbgsj6HEX9ujSbJ$?d_&&nSVZ4;>Mz(F;P)-HY)x>FgTi+Ht@S|'
    'xTt6}#n<XOb;LYGWmF6)huyxlN;aULAUz`1UT{pYjV0X>WU8$hll>=p3`;th|jSn7%St6f5D61t7^PIUf5;DcH~XAw{MdYyPSi}QjU=lpxND|U'
    'hJ2Dpy)%f2j$L$*RRNjz>r1}py6XZV+j0|z|St{vdG+JWCLl)D$wTl77g+g`<05Bzrcy~FuGoZlNKOt0guof7nm^6#2@Oy_hsgcDz<1Hr7YAFY'
    '0Y{Z6{hWpBj!CW0AA_7SZy?rRJe;!i+soxKzv3d`Ra$*`rP{Q!Opz>mop{?N21{$S2oQ}KVXS2<3pd@<#OpA)b#VznD(XKhrRgg+zNigApacoY'
    '~8w5eha3)8oV7#I86=bEM^-%@<mem;Xfmo?|f{(t{JesU3h'
)

def _parent_fixture_bytes():
    values = json.loads(zlib.decompress(base64.b85decode(_PARENT_BYTES)).decode('utf-8'))
    return {path: base64.b64decode(encoded) for path, encoded in values.items()}


def fixture():
    artifacts, entries = {}, []
    def add(path, data, category='source', role='other', dependencies=()):
        artifacts[path] = data
        entry = {'artifact': ref(path, data), 'category': category,
                 'dependencies': list(dependencies), 'role': role}
        entries.append(entry)
        return entry['artifact']
    parents = trusted._parse(Path(__file__).with_name('semantic-v4-adoption-contract.json').read_bytes())['x-contract']['parentContracts']
    for parent in parents:
        add(parent['path'], _parent_fixture_bytes()[parent['path']],
            'protocol' if parent['path'].endswith('.md') else 'schema')
    for name in trusted.CORE_MODULES:
        add(trusted.P + '/' + name + '.py', b'\n')
    for name in ('TRUSTED_V4_INTERFACES.md', 'semantic-v4-trusted-interfaces.schema.json',
                 'semantic-v4-adoption-contract.json', 'SEMANTIC_V4_ADOPTION.md',
                 'semantic-v4-rational-metric-wire-v1.schema.json'):
        add(trusted.P + '/' + name, Path(__file__).with_name(name).read_bytes(), 'schema' if name.endswith('.json') else 'source')
    for path in ('tools/mcp-server/src/server.ts', 'tools/mcp-server/package-lock.json',
                 'tools/content-workbench/Workbench/CodexExecutor.cs',
                 'tools/content-workbench/Workbench/Workbench.csproj'):
        add(trusted.R + '/' + path, b'future frozen fixture\n')
    policy_name = 'semantic-v4-equivalence-input-policy-v2.json'
    for name in [n for n in trusted.C_ASSETS if n != policy_name] + [policy_name]:
        data = Path(trusted.P, name).read_bytes()
        dependencies = []
        if name == policy_name:
            policy = trusted._parse(data)
            dependencies = [policy[key] for key in ('instructions', 'outputSchema', 'scheduleSchema')]
        add(trusted.P + '/' + name, data,
            'prompt' if name == 'private-label-instructions-v1.json' else
            'test' if name.startswith('test_') else 'schema' if name.endswith('.json') else 'source',
            dependencies=dependencies)
    for name in trusted.WORKBENCH_ASSETS:
        path = trusted.R + '/tools/content-workbench/' + name
        if not any(entry['artifact']['path'] == path for entry in entries):
            add(path, Path(path).read_bytes(), 'test' if name.startswith('Workbench.Tests/') else 'source')
    add(trusted.R + '/tools/mcp-server/dist/index.js', b'future bundle\n', 'binary')
    add(trusted.P + '/semantic-v4-proof-output.schema.json',
        Path(__file__).with_name('semantic-v4-proof-output.schema.json').read_bytes(), 'schema', 'proof-output-schema')
    add('/synthetic/site-packages/package/__init__.py', b'\n', 'dependency')
    add(trusted.P + '/requirements.lock.txt', b'fixture==1\n', 'dependency')
    for category in ('test', 'prompt', 'algorithm'):
        add('/synthetic/' + category, b'fixture ' + category.encode(), category)
    add('/synthetic/embedding.bin', b'installed fixture embedding bytes', 'model', 'embedding-model')
    add(trusted.T + '/requested-model-route.json', raw({**common('trusted-requested-model-route'),
        'model': 'gpt-6-sol', 'effort': 'high', 'auth': 'chatgpt', 'reportedModel': None}), 'model', 'model-contract')
    binaries = {}
    for role in ('runner-assembly', 'process-host', 'cli-executable'):
        binaries[role] = add('/synthetic/' + role, b'actual synthetic ' + role.encode(), 'binary', role)
    data = proof_fixtures.SemanticProofDiagnosticsTests().fixture(1)
    source = next(iter(data['sources'].values()))
    chunk = data['evidence'][0]
    corpus = {'model': 'synthetic-installed-model', 'chunking': {'fixture': 1},
              'sources': [{'sourceId': source['sourceId'], 'sourceVersion': source['sourceVersion']}],
              'sourceCount': 1, 'chunkCount': 1}
    corpus['corpusVersion'] = trusted._digest({'sources': [(source['sourceId'], source['sourceVersion'])],
        'chunking': corpus['chunking'], 'embeddingModel': corpus['model']})
    add(trusted.CORPUS + '/manifest.json', raw(corpus), 'dependency')
    add(trusted.CORPUS + '/chunks.json', raw([chunk]), 'dependency')
    add(trusted.CORPUS + '/index.json', raw({'corpusVersion': corpus['corpusVersion'], 'model': corpus['model']}), 'dependency')
    add(trusted.CORPUS + '/sources/' + source['sourceId'] + '.json', raw(source), 'dependency')
    consumer = add('/synthetic/consumer.py', b'\n', 'source', 'consumer', [e['artifact'] for e in entries])
    identity = {key: 'a' * 64 for key in trusted._parse(Path(trusted.SCHEMA_PATH).read_bytes())['$defs']['Identity']['required']}
    identity['implementationManifestHash'] = trusted._digest(entries)
    identity['corpusVersion'] = corpus['corpusVersion']
    for field, category in (('testsHash', 'test'), ('promptsHash', 'prompt'), ('schemaHash', 'schema'),
                            ('algorithmHash', 'algorithm'), ('modelIdentityHash', 'model')):
        identity[field] = trusted._digest([entry['artifact'] for entry in entries if entry['category'] == category])
    identity['embeddingModelHash'] = trusted._digest([entry['artifact'] for entry in entries if entry['role'] == 'embedding-model'])
    for field, name in (('sourceManifestHash', 'manifest'), ('chunksHash', 'chunks'), ('indexHash', 'index')):
        identity[field] = trusted._hash(artifacts[trusted.CORPUS + '/' + name + '.json'])
    identity['protocolHash'] = next(r['sha256'] for r in parents if r['path'].endswith('/semantic-protocol.md'))
    runtime = {**common('trusted-v4-runtime-manifest'), 'entries': entries, 'entrypoints': [consumer],
               'runtime': {'runnerAssemblyHash': binaries['runner-assembly']['sha256'],
                           'processHostHash': binaries['process-host']['sha256'], 'cliVersion': 'synthetic-1'},
               'identity': identity}
    registry = {**common('trusted-v4-execution-registry'), 'entries': []}
    root = {**common('trusted-v4-root'), 'state': 'PASS', 'supervisorTask': 'supervisor',
            'registeredUtc': '2026-10-29T00:00:00Z',
            'runtimeManifest': ref(trusted.T + '/runtime-manifest.json', raw(runtime)),
            'executionRegistry': ref(trusted.T + '/execution-registry.json', raw(registry)),
            'authorities': [{'node': node, 'state': 'UNKNOWN', 'acceptedReview': None,
                             'observation': None, 'boundInputs': []} for node in trusted.NODES],
            'artifacts': [{'slot': 'parent-' + str(index), 'artifact': parent, 'category': 'protocol'}
                          for index, parent in enumerate(parents)]}
    artifacts[root['runtimeManifest']['path']] = raw(runtime)
    artifacts[root['executionRegistry']['path']] = raw(registry)
    return root, runtime, registry, artifacts


def review_fixture(node='current-source-review', report=b'# Native review\nPASS observed rules.\n'):
    root, runtime, registry, artifacts = fixture()
    binding = next(b for b in root['authorities'] if b['node'] == node)
    inputs = list(trusted._runtime_required_inputs(root, runtime).values())
    rules = sorted(trusted.SOURCE_RULES) if node == 'current-source-review' else ['requested-rule']
    request = {**{k: v for k, v in common('trusted-review-request').items() if k != 'releaseAuthorized'},
               'node': node, 'producerTask': 'producer', 'ruleIds': rules,
               'boundInputs': inputs, 'requestText': 'Review exact attached immutable bytes.'}
    base = trusted.T + '/reviews/' + node
    evidence = inputs[0]
    envelope = {**common('trusted-v4-accepted-review'), 'node': node,
        'rawRequest': ref(base + '/request.json', raw(request)), 'rawReport': ref(base + '/report.json', report),
        'supervisorTask': 'supervisor', 'observedTask': 'independent-reviewer',
        'observedModel': 'observed-native-model', 'observedEffort': 'high',
        'observedUtc': '2026-10-29T00:01:00Z', 'context': 'fresh-native',
        'boundInputs': inputs, 'runtimeManifest': root['runtimeManifest'], 'identity': copy.deepcopy(runtime['identity']),
        'ruleOutcomes': [{'ruleId': rule, 'outcome': 'PASS', 'evidence': [evidence],
                          'reason': 'Observed required check completed.'} for rule in rules],
        'limitations': [], 'accepted': 'PASS'}
    binding.update(state='PASS', acceptedReview=ref(base + '/accepted.json', raw(envelope)), boundInputs=inputs)
    for suffix, data, category in (('request', raw(request), 'review-request'),
                                   ('report', report, 'review-report'), ('accepted', raw(envelope), 'accepted-review')):
        path = base + '/' + suffix + '.json'
        artifacts[path] = data
        root['artifacts'].append({'slot': suffix, 'artifact': ref(path, data), 'category': category})
    return root, runtime, registry, artifacts, binding, envelope, request


def _rehash_runtime(root, runtime, artifacts):
    consumer = next(entry for entry in runtime['entries'] if entry['role'] == 'consumer')
    runtime['entries'] = [entry for entry in runtime['entries'] if entry is not consumer]
    consumer['dependencies'] = [entry['artifact'] for entry in runtime['entries']]
    runtime['entries'].append(consumer)
    runtime['identity']['implementationManifestHash'] = trusted._digest(runtime['entries'])
    for category, field in (('schema', 'schemaHash'), ('prompt', 'promptsHash'), ('test', 'testsHash'),
                            ('algorithm', 'algorithmHash'), ('model', 'modelIdentityHash')):
        runtime['identity'][field] = trusted._digest([entry['artifact'] for entry in runtime['entries'] if entry['category'] == category])
    path = trusted.T + '/runtime-manifest.json'
    artifacts[path] = raw(runtime)
    root['runtimeManifest'] = ref(path, artifacts[path])


def _install_review(f, node):
    """Future observed review shape, not a claim of actual review or equivalence."""
    inputs = list(trusted._runtime_required_inputs(f.root, f.manifest).values())
    rules = sorted(trusted.SOURCE_RULES) if node == 'current-source-review' else ['synthetic-interface-rule']
    base = trusted.T + '/reviews/' + node
    request = {k: v for k, v in common('trusted-review-request').items() if k != 'releaseAuthorized'}
    request.update(node=node, producerTask='synthetic-producer', ruleIds=rules, boundInputs=inputs,
                   requestText='Synthetic interface fixture: verify the exact attached bytes.')
    request_ref = f.put(base + '/request.json', request)
    report_ref = f.put(base + '/report.json', b'# Synthetic observed independent review\n')
    envelope = {**common('trusted-v4-accepted-review'), 'node': node, 'rawRequest': request_ref,
        'rawReport': report_ref, 'supervisorTask': f.root['supervisorTask'],
        'observedTask': 'synthetic-independent-' + node, 'observedModel': 'synthetic-native-model',
        'observedEffort': 'high', 'observedUtc': '2026-10-28T23:00:00Z', 'context': 'fresh-native',
        'boundInputs': inputs, 'runtimeManifest': f.root['runtimeManifest'], 'identity': f.manifest['identity'],
        'ruleOutcomes': [{'ruleId': rule, 'outcome': 'PASS', 'evidence': [f.root['runtimeManifest']],
                          'reason': 'Synthetic observed interface check.'} for rule in rules],
        'limitations': [], 'accepted': 'PASS'}
    accepted = f.put(base + '/accepted.json', envelope)
    binding = next(item for item in f.root['authorities'] if item['node'] == node)
    binding.update(state='PASS', acceptedReview=accepted, observation=None, boundInputs=inputs)


def _complete_proof_snapshot_fixture(test):
    """Complete Stage B snapshot; synthetic adopted inputs do not prove R01-R17."""
    from test_trusted_custody_v4 import Fixture, RegistryTests
    from proof_transport_v4 import compact_schedule
    f = Fixture()
    f.root, f.manifest, registry, f.artifacts = fixture()
    f.protocol = next(slot['artifact'] for slot in f.root['artifacts'] if slot['artifact']['path'].endswith('/semantic-protocol.md'))
    f.access = next(slot['artifact'] for slot in f.root['artifacts'] if slot['artifact']['path'].endswith('/access-protocol.md'))
    original, sources = trusted._corpus_maps(f.manifest, f.artifacts)
    evidence = list(original.values())
    group = {'id': 'group-one', 'requiredFacts': [{'id': 'fact-one', 'text': 'Synthetic fact'}], 'mandatoryScope': []}
    case = {'id': 'case-one', 'module': 'cloud', 'queryEn': 'Synthetic question?',
            'answerable': True, 'groups': [group], 'negativeReason': None}
    references = f.put(trusted.D + '/references.json', {'queries': [case]})
    packet = f.put(trusted.E + '/dev/A/packets/case-one.json', {'query': case['queryEn'], 'evidence': evidence})
    raw_builder = RegistryTests(); raw_builder.f = f
    test.addCleanup(raw_builder.doCleanups)
    planned = compact_schedule(case['id'], case['queryEn'], group, evidence, original)
    proof_schema = Path(__file__).with_name('semantic-v4-proof-output.schema.json').read_bytes()
    result = {'quotes': [], 'subsets': [{'mask': 1, 'verdict': 'UNKNOWN', 'coverage': [],
                                      'deploymentConsistent': 'UNKNOWN', 'reason': 'Synthetic no semantic credit'}]}
    for role in ('one', 'two'):
        call = next(call for call in planned['calls'] if call['checkerId'] == role)
        output = f"{trusted.D}/A/raw/case-one/group-one/{role}/0"
        entry = raw_builder.raw_entry(output, call['prompt'], role, call['projectionHash'], schema=proof_schema, result=result)
        entry.update(purpose='dev-proof', scope={'configuration': 'A', 'caseIds': ['case-one'],
            'groupId': 'group-one', 'packets': [packet], 'reference': references, 'protocol': f.protocol,
            'projectionHash': call['projectionHash'], 'prompt': entry.pop('promptRef'), 'schema': entry['emittedSchema']})
        invocation = trusted._parse(f.artifacts[entry['invocation']['path']])
        invocation['startedUtc'] = '2026-10-29T00:01:01Z'
        entry['invocation'] = f.put(entry['invocation']['path'], invocation)
        entry['trustedPins']['expectedFileHashes']['invocation.json'] = entry['invocation']['sha256']
        entry['observedUtc'] = '2026-10-29T00:02:00Z'
        registry['entries'].append(entry)
    _rehash_runtime(f.root, f.manifest, f.artifacts)
    # Four independently registered current review records and a genuine-shaped
    # complete denial event make the nonempty public-loader success branch real.
    for node in ('contract-review', 'reference-equivalence', 'adoption-implementation-review', 'current-source-review'):
        _install_review(f, node)
    denial = f.denial()
    binding = next(item for item in f.root['authorities'] if item['node'] == 'isolation-denial')
    binding.update(state='PASS', acceptedReview=None,
        observation=ref(trusted.T + '/custodian/0.json', f.artifacts[trusted.T + '/custodian/0.json']),
        boundInputs=[f.root['runtimeManifest'], denial['actionRecord'], f.access])
    schema = trusted._parse(Path(__file__).with_name('semantic-v4-adoption-contract.json').read_bytes())
    consumer = {'identity': f.manifest['identity'], 'dependencyManifest': f.root['runtimeManifest'],
        'adoptionContract': ref(trusted.P + '/semantic-v4-adoption-contract.json', f.artifacts[trusted.P + '/semantic-v4-adoption-contract.json']),
        'adoptionDocument': ref(trusted.P + '/SEMANTIC_V4_ADOPTION.md', f.artifacts[trusted.P + '/SEMANTIC_V4_ADOPTION.md'])}
    seed = f.put(trusted.T + '/synthetic-upstream.json', b'{}')
    def registered_refs(value):
        if type(value) is dict:
            if set(value) == {'path', 'sha256'}: return seed
            return {key: '/synthetic' if key.endswith('Pointer') and type(child) is str else registered_refs(child) for key, child in value.items()}
        if type(value) is list: return [registered_refs(child) for child in value]
        return value
    mapping = registered_refs(sample(schema, 'ReferenceMapping'))
    mapping.update(proofConsumer=consumer, adaptedReferences=references)
    for index, row in enumerate(mapping['cases']): row['caseId'] = 'case-one' if index == 0 else 'case-' + str(index)
    mapping_ref = f.put(trusted.D + '/reference-mapping.json', mapping)
    trusted._validate_adoption_record(mapping, 'ReferenceMapping')
    inventory = sample(schema, 'PacketInventory')
    inventory.update(proofConsumer=consumer, referenceMapping=mapping_ref, adaptedReferences=references, rows=[])
    for config in ('A', 'B'):
        for index in range(80):
            cid = 'case-one' if index == 0 else 'case-' + str(index)
            original_packet = packet if config == 'A' and index == 0 else f.put(
                f'{trusted.E}/dev/{config}/packets/{cid}.json', {'query': case['queryEn'], 'evidence': evidence})
            wrapper = sample(schema, 'PacketAdoption')
            wrapper.update(configuration=config, caseId=cid, originalPacket=original_packet, originalProvenance=[],
                originalRetrievalIdentityHash=trusted._digest({'packet': original_packet, 'provenance': []}),
                proofConsumer=consumer, referenceMapping=mapping_ref)
            trusted._validate_adoption_record(wrapper, 'PacketAdoption')
            wrapper_ref = f.put(f'{trusted.D}/{config}/packets/{cid}.json', wrapper)
            inventory['rows'].append({'configuration': config, 'caseId': cid,
                                     'originalPacket': original_packet, 'packetAdoption': wrapper_ref})
    inventory_ref = f.put(trusted.D + '/packet-inventory.json', inventory)
    prerequisites = [binding for binding in f.root['authorities'] if binding['node'] in
                     trusted.PERMISSION_PREREQUISITES['DEV_PROOF_EXECUTION']]
    required = {f.root['runtimeManifest']['path'], mapping_ref['path'], inventory_ref['path'], references['path'], f.protocol['path']}
    for binding in prerequisites:
        required |= {item['path'] for item in binding['boundInputs']}
        required |= {item['path'] for item in (binding['acceptedReview'], binding['observation']) if item}
    required |= {entry['artifact']['path'] for entry in f.manifest['entries'] if entry['category'] in ('prompt', 'schema')}
    required |= {row[key]['path'] for row in inventory['rows'] for key in ('originalPacket', 'packetAdoption')}
    required |= {consumer[key]['path'] for key in ('dependencyManifest', 'adoptionContract', 'adoptionDocument')}
    authorization = {**common('trusted-v4-authorization'), 'permission': 'DEV_PROOF_EXECUTION',
        'supervisorTask': f.root['supervisorTask'], 'observedUtc': '2026-10-29T00:01:00Z',
        'runtimeManifest': f.root['runtimeManifest'], 'identity': f.manifest['identity'],
        'boundInputs': [ref(path, f.artifacts[path]) for path in sorted(required)], 'prerequisites': prerequisites}
    auth_ref = f.put(trusted.T + '/authorizations/DEV_PROOF_EXECUTION.json', authorization)
    for entry in registry['entries']:
        entry.update(authorization=auth_ref, runtimeManifest=f.root['runtimeManifest'])
    f.root['executionRegistry'] = f.put(trusted.T + '/execution-registry.json', registry)
    # Replacing input slots during fixture assembly must not duplicate slot IDs.
    for ordinal, slot in enumerate(f.root['artifacts']): slot['slot'] = 'complete-' + str(ordinal)
    trusted._validate_authorization(f.root, f.manifest, authorization, f.artifacts)
    return f, registry


class TrustedCoreTests(unittest.TestCase):
    def test_equivalence_policy_declares_exact_three_prior_dependencies(self):
        root, runtime, _, artifacts = fixture()
        path = trusted.P + '/semantic-v4-equivalence-input-policy-v2.json'
        policy = trusted._parse(artifacts[path])
        expected = [policy[key] for key in ('instructions', 'outputSchema', 'scheduleSchema')]
        positions = {entry['artifact']['path']: n for n, entry in enumerate(runtime['entries'])}
        entry = runtime['entries'][positions[path]]
        self.assertEqual(entry['dependencies'], expected)
        self.assertTrue(all(positions[ref['path']] < positions[path] for ref in expected))
        self.assertIs(runtime, trusted._validate_runtime_manifest(root, runtime, artifacts))

    def test_equivalence_policy_dag_mutations_reject_after_consistent_manifest_rehash(self):
        for change in ('empty', 'missing-instructions', 'missing-outputSchema', 'missing-scheduleSchema',
                       'wrong', 'duplicate', 'reordered', 'extra', 'later'):
            with self.subTest(change=change):
                root, runtime, _, artifacts = fixture()
                path = trusted.P + '/semantic-v4-equivalence-input-policy-v2.json'
                entry = next(e for e in runtime['entries'] if e['artifact']['path'] == path)
                dependencies = entry['dependencies']
                if change == 'empty': dependencies.clear()
                elif change.startswith('missing-'):
                    dependencies.pop(('instructions', 'outputSchema', 'scheduleSchema').index(change[8:]))
                elif change == 'wrong': dependencies[0] = runtime['entries'][0]['artifact']
                elif change == 'duplicate': dependencies[1] = dependencies[0]
                elif change == 'reordered': dependencies[0], dependencies[1] = dependencies[1], dependencies[0]
                elif change == 'extra': dependencies.append(runtime['entries'][0]['artifact'])
                elif change == 'later':
                    runtime['entries'].remove(entry)
                    index = next(n for n, e in enumerate(runtime['entries']) if e['artifact'] == dependencies[-1])
                    runtime['entries'].insert(index, entry)
                _rehash_runtime(root, runtime, artifacts)
                self.assertEqual(trusted._parse(trusted._ref(root['runtimeManifest'], artifacts)), runtime)
                self.assertEqual(runtime['identity']['implementationManifestHash'], trusted._digest(runtime['entries']))
                for runtime_entry in runtime['entries']:
                    trusted._ref(runtime_entry['artifact'], artifacts)
                with self.assertRaisesRegex(ValueError, 'policy.*dependencies|Dependency must equal an earlier'):
                    trusted._validate_runtime_manifest(root, runtime, artifacts)

    def test_positive_runtime_complete_dag_and_native_varied_reports(self):
        root, runtime, _, artifacts = fixture()
        self.assertIs(runtime, trusted._validate_runtime_manifest(root, runtime, artifacts))
        for report in (b'# Actual native report\nAll reviewed rules passed.\n', b'{"native":"arbitrary report wire"}'):
            r, m, _, a, binding, _, _ = review_fixture(report=report)
            self.assertEqual('PASS', trusted._validate_review(r, m, binding, a)['accepted'])

    def test_runtime_tamper_cycles_invented_hash_and_missing_dependency(self):
        for change in ('cycle', 'duplicate', 'self', 'missing-module', 'bad-binary', 'invented-hash',
                       'missing-model', 'missing-category', 'unreachable', 'missing-import', 'missing-route',
                       'forged-route', 'generated-instance'):
            root, runtime, _, artifacts = fixture()
            if change == 'cycle': runtime['entries'][0]['dependencies'] = [runtime['entries'][-1]['artifact']]
            if change == 'duplicate': runtime['entries'].append(copy.deepcopy(runtime['entries'][0]))
            if change == 'self': runtime['entries'][0]['artifact']['path'] = trusted.T + '/runtime-manifest.json'
            if change == 'missing-module': runtime['entries'] = [e for e in runtime['entries'] if not e['artifact']['path'].endswith('/author.py')]
            if change == 'bad-binary': runtime['runtime']['runnerAssemblyHash'] = '0' * 64
            if change == 'invented-hash': runtime['entries'][0]['artifact']['sha256'] = '0' * 64
            if change == 'missing-model': runtime['entries'] = [e for e in runtime['entries'] if e['role'] != 'embedding-model']
            if change == 'missing-category': runtime['entries'] = [e for e in runtime['entries'] if e['category'] != 'prompt']
            if change == 'missing-route': runtime['entries'] = [e for e in runtime['entries'] if e['role'] != 'model-contract']
            if change == 'forged-route':
                entry = next(e for e in runtime['entries'] if e['role'] == 'model-contract')
                value = trusted._parse(artifacts[entry['artifact']['path']]); value['reportedModel'] = 'verified-model'
                artifacts[entry['artifact']['path']] = raw(value)
                entry['artifact']['sha256'] = trusted._hash(artifacts[entry['artifact']['path']])
            if change == 'generated-instance':
                runtime['entries'][5]['artifact']['path'] = trusted.C + '/evidence/fabricated/results.json'
            if change == 'unreachable': runtime['entrypoints'] = [runtime['entries'][4]['artifact']]
            if change == 'missing-import':
                entry = next(e for e in runtime['entries'] if e['artifact']['path'].endswith('/author.py'))
                artifacts[entry['artifact']['path']] = b'import missing_package\n'
                entry['artifact']['sha256'] = trusted._hash(artifacts[entry['artifact']['path']])
            with self.subTest(change=change), self.assertRaises(ValueError):
                trusted._validate_runtime_manifest(root, runtime, artifacts)

    def test_source_review_exact_rules_inputs_independence_and_conjunction(self):
        for change in ('rule', 'unknown', 'input', 'producer', 'supervisor', 'runtime', 'false-headline'):
            root, runtime, _, artifacts, binding, envelope, request = review_fixture()
            if change == 'rule': envelope['ruleOutcomes'].pop()
            if change == 'unknown': envelope['ruleOutcomes'][0]['outcome'] = 'UNKNOWN'
            if change == 'input': envelope['boundInputs'] = envelope['boundInputs'][:-1]
            if change == 'producer': envelope['observedTask'] = request['producerTask']
            if change == 'supervisor': envelope['observedTask'] = root['supervisorTask']
            if change == 'runtime': envelope['identity']['testsHash'] = '0' * 64
            if change == 'false-headline': envelope['accepted'] = 'FAIL'
            path = binding['acceptedReview']['path']
            artifacts[path] = raw(envelope)
            binding['acceptedReview'] = ref(path, artifacts[path])
            with self.subTest(change=change), self.assertRaises(ValueError):
                trusted._validate_review(root, runtime, binding, artifacts)

    def test_strict_closed_json_and_actual_integer_tokens(self):
        for value in (b'{"a":1,"a":2}', b'{"a":NaN}', b'"\\ud800"', b'[' * 66 + b'0' + b']' * 66):
            with self.assertRaises(ValueError): trusted._parse(value)
        observation_schema = trusted._parse(Path(trusted.SCHEMA_PATH).read_bytes())
        observation_schema['$defs']['CustodianDetail'] = observation_schema['$defs']['CustodianDetail']['oneOf'][0]
        value = sample(observation_schema, 'CustodianObservation')
        for token in (True, 1.0, trusted._parse(b'1e0')):
            value['sequence'] = token
            with self.assertRaises(ValueError): trusted._validate_record(value, 'CustodianObservation')
        root, _, _, _ = fixture()
        root['authorityOverride'] = True
        with self.assertRaises(ValueError): trusted._validate_record(root, 'RootNode')

    def test_safe_reads_no_symlink_hardlink_alias_oversize_or_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory).resolve()
            file = base / 'record.json'; file.write_bytes(b'{}')
            self.assertEqual(b'{}', trusted._read_stable(str(file)))
            alias = base / 'alias'; alias.symlink_to(file)
            with self.assertRaises(ValueError): trusted._read_stable(str(alias))
            parent = base / 'parent'; parent.symlink_to(base, target_is_directory=True)
            with self.assertRaises(ValueError): trusted._read_stable(str(parent / 'record.json'))
            with self.assertRaises(ValueError): trusted._read_stable(str(file), 1)
            with self.assertRaises(ValueError): trusted._read_stable(str(base) + '/../record.json')
            hard = base / 'hard'; os.link(file, hard)
            with self.assertRaises(ValueError): trusted._read_stable(str(file))
            hard.unlink()
            identities = set(); trusted._read_stable(str(file), identities=identities)
            with self.assertRaises(ValueError): trusted._read_stable(str(file), identities=identities)
            real_fstat = trusted.os.fstat
            calls = []
            def changed(fd):
                calls.append(fd)
                if len(calls) == 2:
                    file.write_bytes(b'{"changed":true}')
                return real_fstat(fd)
            with patch.object(trusted.os, 'fstat', side_effect=changed), self.assertRaises(ValueError):
                trusted._read_stable(str(file))

    def test_authority_graph_missing_prerequisite_and_unregistered_report(self):
        root, runtime, _, artifacts, binding, _, _ = review_fixture()
        self.assertEqual('PASS', trusted._validate_authorities(root, runtime, artifacts)['current-source-review']['state'])
        root['authorities'].pop()
        with self.assertRaises(ValueError): trusted._validate_authorities(root, runtime, artifacts)
        root, runtime, _, artifacts = fixture()
        binding = next(b for b in root['authorities'] if b['node'] == 'isolation-denial')
        binding['state'] = 'PASS'; binding['boundInputs'] = [root['runtimeManifest']]
        with self.assertRaises(ValueError): trusted._validate_authorities(root, runtime, artifacts)

    def test_public_signatures_have_no_override_and_unbranded_objects_reject(self):
        expected = {'load_trusted_snapshot_v4': [], 'require_authority_v4': ['snapshot', 'node'],
            'registered_executions_v4': ['snapshot', 'purpose', 'configuration', 'case_ids', 'group_id'],
            'verify_custodian_chain_v4': ['snapshot'], 'validate_selection_bridge_v4': ['snapshot']}
        for name, parameters in expected.items():
            self.assertEqual(parameters, list(inspect.signature(getattr(trusted, name)).parameters))
        for call in (lambda: trusted.require_authority_v4({}, 'current-source-review'),
                     lambda: trusted.verify_custodian_chain_v4({}),
                     lambda: trusted.validate_selection_bridge_v4({})):
            with self.assertRaises(ValueError): call()
        with patch.object(trusted, '_read_root', side_effect=ValueError('Missing fixed supervisor trusted root')):
            with self.assertRaises(ValueError): trusted.load_trusted_snapshot_v4()

    def test_snapshot_immutability_and_synthetic_brand_reject_all_public_consumers(self):
        root, runtime, registry, artifacts = fixture()
        snapshot = trusted._snapshot_from_test_bytes(root, runtime, registry, artifacts)
        with self.assertRaises(TypeError): snapshot.rootNode['state'] = 'PASS'
        with self.assertRaises(FrozenInstanceError): snapshot.rootNodeHash = 'a' * 64
        for call in (lambda: trusted.require_authority_v4(snapshot, 'current-source-review'),
                     lambda: trusted.registered_executions_v4(snapshot, 'dev-proof', 'A', ['a'], 'a'),
                     lambda: trusted.verify_custodian_chain_v4(snapshot),
                     lambda: trusted.validate_selection_bridge_v4(snapshot)):
            with self.assertRaisesRegex(ValueError, 'Synthetic'): call()


    def test_embedded_parent_fixtures_match_all_four_frozen_pins(self):
        parents = trusted._parse(Path(__file__).with_name('semantic-v4-adoption-contract.json').read_bytes())['x-contract']['parentContracts']
        decoded = _parent_fixture_bytes()
        self.assertEqual(4, len(decoded))
        for parent in parents:
            self.assertEqual(parent['sha256'], trusted._hash(decoded[parent['path']]))

    def test_public_fixed_loader_currentness_without_real_files_or_actions(self):
        root, runtime, registry, artifacts, _, _, _ = review_fixture()
        corpus = trusted._parse(artifacts[trusted.CORPUS + '/manifest.json'])
        run = {'nodes': {'A3V4-trusted-root': root, 'A2R-corpus': {
            'status': 'produced', 'corpusVersion': corpus['corpusVersion'],
            'sourceCount': 1, 'chunkCount': 1}}}
        files = dict(artifacts)
        files[trusted.C + '/run.json'] = raw(run)
        real_schema = Path(trusted.SCHEMA_PATH).read_bytes()
        def read(path, limit=2_000_000, identities=None):
            value = (real_schema if path == trusted.SCHEMA_PATH else
                     Path(__file__).with_name('semantic-v4-proof-output.schema.json').read_bytes()
                     if path == str(Path(trusted.SCHEMA_PATH).with_name('semantic-v4-proof-output.schema.json'))
                     else files[path])
            if len(value) > limit: raise ValueError('Fixture exceeds reviewed bound')
            return value
        with patch.object(trusted, '_read_stable', side_effect=read), patch.object(
                trusted, '__file__', trusted.P + '/trusted_interfaces_v4.py'):
            snapshot = trusted.load_trusted_snapshot_v4()
            self.assertEqual('PASS', trusted.require_authority_v4(snapshot, 'current-source-review')['state'])
            with self.assertRaises(ValueError): trusted.require_authority_v4(snapshot, 'isolation-denial')
            self.assertNotIn('authority.json', files)
            # Unrelated mutable run-state changes do not invalidate node identity.
            run['nodes']['unrelated'] = {'state': 'changed'}
            files[trusted.C + '/run.json'] = raw(run)
            trusted.require_authority_v4(snapshot, 'current-source-review')
            run['nodes']['A3V4-trusted-root']['registeredUtc'] = '2026-10-30T00:00:00Z'
            files[trusted.C + '/run.json'] = raw(run)
            with self.assertRaisesRegex(ValueError, 'root changed'):
                trusted.require_authority_v4(snapshot, 'current-source-review')
            run['nodes']['A3V4-trusted-root']['registeredUtc'] = '2026-10-29T00:00:00Z'
            files[trusted.C + '/run.json'] = raw(run)
            files[trusted.P + '/author.py'] += b'# mutation'
            with self.assertRaisesRegex(ValueError, 'input changed'):
                trusted.require_authority_v4(snapshot, 'current-source-review')

    def test_exact_permission_bindings_prerequisites_and_no_downstream_cycle(self):
        root, runtime, _, artifacts = fixture()
        names = trusted.PERMISSION_PREREQUISITES['DEV_EQUIVALENCE_EXECUTION']
        inputs = [root['runtimeManifest']]
        for name in names:
            binding = next(item for item in root['authorities'] if item['node'] == name)
            path = trusted.T + '/reviews/' + name + '/accepted.json'
            artifacts[path] = b'external accepted binding fixture'
            binding.update(state='PASS', acceptedReview=ref(path, artifacts[path]), boundInputs=inputs)
        required_paths = {root['runtimeManifest']['path'], trusted.D + '/candidate-mapping.json',
            trusted.D + '/references.json', trusted.D + '/reviews/schedule.json',
            trusted.C + '/design/rag-v2-bounded/r4/semantic-protocol.md'}
        required_paths |= {entry['artifact']['path'] for entry in runtime['entries'] if entry['category'] in ('prompt', 'schema')}
        for name in names: required_paths.add(trusted.T + '/reviews/' + name + '/accepted.json')
        for path in required_paths:
            if path not in artifacts: artifacts[path] = raw({'batches': []}) if path.endswith('/schedule.json') else b'fixed input'
        schedule_schema = trusted._parse(Path(__file__).with_name('semantic-v4-adoption-contract.json').read_bytes())
        schedule = sample(schedule_schema, 'EquivalenceSchedule')
        schedule['batches'][0]['batchOrdinal'] = 0
        artifacts[trusted.D + '/reviews/schedule.json'] = raw(schedule)
        projection = trusted.D + '/reviews/projections/0.json'; artifacts[projection] = b'fixed planned projection'
        required_paths.add(projection)
        authorization = {**common('trusted-v4-authorization'), 'permission': 'DEV_EQUIVALENCE_EXECUTION',
            'supervisorTask': root['supervisorTask'], 'observedUtc': '2026-10-29T00:01:00Z',
            'runtimeManifest': root['runtimeManifest'], 'identity': runtime['identity'],
            'boundInputs': [ref(path, artifacts[path]) for path in sorted(required_paths)],
            'prerequisites': [next(b for b in root['authorities'] if b['node'] == name) for name in names]}
        self.assertIs(authorization, trusted._validate_authorization(root, runtime, authorization, artifacts))
        for change in ('missing', 'extra', 'prerequisite', 'identity', 'later-output'):
            bad = copy.deepcopy(authorization)
            if change == 'missing': bad['boundInputs'].pop()
            if change == 'extra':
                artifacts['/synthetic/arbitrary'] = b'x'
                bad['boundInputs'].append(ref('/synthetic/arbitrary', b'x'))
            if change == 'prerequisite': bad['prerequisites'].pop()
            if change == 'identity': bad['identity']['algorithmHash'] = '0' * 64
            if change == 'later-output':
                artifacts[trusted.D + '/A/results.json'] = b'x'
                bad['boundInputs'].append(ref(trusted.D + '/A/results.json', b'x'))
            with self.subTest(change=change), self.assertRaises(ValueError):
                trusted._validate_authorization(root, runtime, bad, artifacts)

    def test_selection_private_exact_fraction_bridge_and_ties(self):
        adoption_schema = trusted._parse(Path(__file__).with_name('semantic-v4-adoption-contract.json').read_bytes())
        wire_schema = trusted._parse(Path(__file__).with_name('semantic-v4-rational-metric-wire-v1.schema.json').read_bytes())
        for scores, winner in (((metrics(Fraction(1,3), Fraction(1,7)), metrics(Fraction(1,7), Fraction(1))), 'A'),
                               ((metrics(Fraction(1,3), Fraction(1,7)), metrics(Fraction(1,3), Fraction(1,3))), 'B'),
                               ((metrics(), metrics()), 'A')):
            _, runtime, _, artifacts = fixture()
            identity = runtime['identity']
            results, verified = {}, {}
            selection = sample(wire_schema, 'SelectionEnvelope')
            selection['identity'] = identity
            payload = selection['payload']; payload.update(selected=winner, newConfigurationCount=2, evaluated=[])
            for config, score in zip(('A', 'B'), scores):
                result = sample(adoption_schema, 'DevResults')
                result['configuration'] = result['payload']['configuration'] = config
                result['proofConsumer']['identity'] = identity
                case_metrics = {}
                for index, case in enumerate(result['payload']['cases']):
                    case['caseId'] = 'case-' + str(index)
                    if index < 64:
                        case['metrics'] = encode_metrics(score)
                        case['completions'] = [{'groupId': 'group-a', 'rank': 3, 'witness': ['a' * 32]}]
                        case_metrics[case['caseId']] = score
                    else:
                        case.update(metrics=None, completions=[], proof=None, legacyDiagnosticMetrics=None)
                        case_metrics[case['caseId']] = None
                result['payload']['macro'] = encode_metrics(score)
                result['payload']['perThemeRecall'] = [{'theme': theme, 'value': encode_ratio(score['semanticCompleteGroupRecallAt8'])} for theme in THEMES]
                verified[config] = {'cases': case_metrics, 'macro': score,
                    'perThemeRecall': {theme: score['semanticCompleteGroupRecallAt8'] for theme in THEMES}}
                results[config] = result
                path = trusted.D + '/' + config + '/results.json'; artifacts[path] = raw(result)
                correctness = trusted.T + '/reviews/correctness-' + config + '.json'; artifacts[correctness] = b'observed accepted review'
                payload['evaluated'].append({'configuration': config, 'result': ref(path, artifacts[path]),
                                              'correctnessReview': ref(correctness, artifacts[correctness])})
            parent = trusted._parse(_parent_fixture_bytes()[trusted.C + '/design/rag-v2-bounded/r4/contracts.schema.json'])
            profile = {'schemaVersion': 4, 'cycleId': trusted.CYCLE_ID, 'retrievalVersion': 4,
                       'metricVersion': 'complete-group-v1', 'kind': 'profile', 'identity': identity,
                       'payload': sample(parent, 'Profile')}
            profile['payload'].update(configuration=winner, radius=1 if winner == 'A' else 2)
            map_path = trusted.E + '/structural-map.json'; artifacts[map_path] = b'fixed parent map bytes'
            profile['payload']['map'] = ref(map_path, artifacts[map_path])
            profile_path = trusted.E + '/profiles/' + winner + '.json'; artifacts[profile_path] = raw(profile)
            canary = trusted.E + '/integration-canary.json'; artifacts[canary] = b'accepted canary'
            payload['profile'] = ref(profile_path, artifacts[profile_path]); payload['canary'] = ref(canary, artifacts[canary])
            self.assertEqual(winner, trusted._validate_selection_context(selection, results, verified, artifacts, identity))
            for change in ('winner', 'mixed-wire', 'summary-tamper', 'wrong-path', 'missing-case', 'extra-configuration'):
                bad_selection, bad_results, bad_verified, bad_artifacts = copy.deepcopy((selection, results, verified, artifacts))
                if change == 'winner': bad_selection['payload']['selected'] = 'B' if winner == 'A' else 'A'
                if change == 'mixed-wire': bad_results['A']['metricWireVersion'] = 'legacy-numeric-v1'
                if change == 'summary-tamper': bad_verified['A']['macro'] = metrics(Fraction(1), Fraction(1))
                if change == 'wrong-path': bad_selection['payload']['evaluated'][0]['result']['path'] = trusted.E + '/A/results.json'
                if change == 'missing-case': bad_verified['A']['cases'].pop('case-0')
                if change == 'extra-configuration': bad_selection['payload']['evaluated'].append(copy.deepcopy(payload['evaluated'][0]))
                with self.subTest(change=change, winner=winner), self.assertRaises(ValueError):
                    trusted._validate_selection_context(bad_selection, bad_results, bad_verified, bad_artifacts, identity)


    def test_complete_runtime_fixture_uses_exact_temp_file_bytes(self):
        root, runtime, _, artifacts = fixture()
        with tempfile.TemporaryDirectory() as directory:
            copied = {}
            identities = set()
            for ordinal, (logical_path, data) in enumerate(artifacts.items()):
                actual = str(Path(directory).resolve() / str(ordinal))
                Path(actual).write_bytes(data)
                copied[logical_path] = trusted._read_stable(actual, max(2_000_000, len(data)), identities)
            trusted._validate_runtime_manifest(root, runtime, copied)
            copied[runtime['entries'][5]['artifact']['path']] += b'changed'
            with self.assertRaises(ValueError): trusted._validate_runtime_manifest(root, runtime, copied)


    def test_pre_read_raw_catalog_rejects_unregistered_files_without_opening(self):
        root, _, registry, _ = fixture()
        root['artifacts'].append({'slot': 'forged-raw', 'category': 'raw-execution',
            'artifact': ref(trusted.D + '/A/raw/invented/result.json', b'secret must not open')})
        with self.assertRaisesRegex(ValueError, 'not derived'):
            trusted._prevalidate_registry_paths(root, registry)


    def test_nonempty_fixed_public_loader_complete_registered_proof_snapshot(self):
        f, registry = _complete_proof_snapshot_fixture(self)
        trusted._prevalidate_registry_paths(f.root, registry)
        trusted._snapshot_from_test_bytes(f.root, f.manifest, registry, f.artifacts)
        corpus = trusted._parse(f.artifacts[trusted.CORPUS + '/manifest.json'])
        run = {'nodes': {'A3V4-trusted-root': f.root, 'A2R-corpus': {'status': 'produced',
            'corpusVersion': corpus['corpusVersion'], 'sourceCount': 1, 'chunkCount': 1}}}
        files = dict(f.artifacts); files[trusted.C + '/run.json'] = raw(run)
        with tempfile.TemporaryDirectory() as directory:
            physical = {}
            for ordinal, (logical, data) in enumerate(files.items()):
                path = Path(directory).resolve() / str(ordinal); path.write_bytes(data)
                physical[logical] = str(path)
            physical[trusted.SCHEMA_PATH] = physical[trusted.P + '/semantic-v4-trusted-interfaces.schema.json']
            physical[str(trusted.CONTRACT_PATH)] = physical[trusted.P + '/semantic-v4-adoption-contract.json']
            actual_read = trusted._read_stable
            reads = []
            def read(logical, limit=2_000_000, identities=None):
                reads.append(logical)
                return actual_read(physical[logical], limit, identities)
            with patch.object(trusted, '_read_stable', side_effect=read), patch.object(
                    trusted, '__file__', trusted.P + '/trusted_interfaces_v4.py'):
                snapshot = trusted.load_trusted_snapshot_v4()
                executions = trusted.registered_executions_v4(snapshot, 'dev-proof', 'A', ['case-one'], 'group-one')
                self.assertEqual(['one', 'two'], [row['checkerId'] for row in executions])
                self.assertEqual(2, len(snapshot.executionRegistry['entries']))
                self.assertEqual('PASS', trusted.require_authority_v4(snapshot, 'current-source-review')['state'])
                self.assertTrue(all(entry['scope']['prompt']['path'] in reads for entry in registry['entries']))
                self.assertTrue(all(entry[field]['path'] in reads for entry in registry['entries'] for field in
                                    ('execution', 'invocation', 'result', 'events', 'stderr', 'emittedSchema')))
                # Fresh source bytes invalidate the same snapshot immediately.
                Path(physical[trusted.P + '/author.py']).write_bytes(b'# changed source')
                with self.assertRaisesRegex(ValueError, 'input changed'):
                    trusted.registered_executions_v4(snapshot, 'dev-proof', 'A', ['case-one'], 'group-one')
        for mutation in ('missing-prompt', 'wrong-path', 'top-level-prompt'):
            bad = copy.deepcopy(registry)
            entry = bad['entries'][0]
            if mutation == 'missing-prompt': entry['scope'].pop('prompt')
            if mutation == 'wrong-path': entry['scope']['prompt']['path'] += '.alias'
            if mutation == 'top-level-prompt': entry['prompt'] = entry['scope']['prompt']
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                trusted._prevalidate_registry_paths(f.root, bad)

    def test_fixed_proof_schema_role_and_bytes_after_rehashed_logical_mutations(self):
        for mutation in ('missing', 'duplicate', 'wrong-path', 'wrong-category', 'different-valid-schema'):
            root, runtime, _, artifacts = fixture()
            designated = next(entry for entry in runtime['entries'] if entry['role'] == 'proof-output-schema')
            if mutation == 'missing': runtime['entries'].remove(designated)
            if mutation == 'duplicate':
                extra = copy.deepcopy(designated); extra['artifact']['path'] = '/synthetic/second-proof-schema.json'
                artifacts[extra['artifact']['path']] = artifacts[designated['artifact']['path']]
                runtime['entries'].insert(0, extra)
            if mutation == 'wrong-path':
                old = designated['artifact']['path']; designated['artifact']['path'] = '/synthetic/substitute-schema.json'
                artifacts[designated['artifact']['path']] = artifacts[old]
            if mutation == 'wrong-category': designated['category'] = 'dependency'
            if mutation == 'different-valid-schema':
                data = b'{"type":"object","additionalProperties":false}'
                artifacts[designated['artifact']['path']] = data
                designated['artifact']['sha256'] = trusted._hash(data)
            _rehash_runtime(root, runtime, artifacts)
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, 'proof output schema|Proof output schema|closed RuntimeManifest'):
                trusted._validate_runtime_manifest(root, runtime, artifacts)

    def test_label_permission_requires_complete_prior_stop_prefix_without_future_cycle(self):
        from trusted_custody_v4 import _validate_label_authorization_prefix_v4
        f, registry = _complete_proof_snapshot_fixture(self)
        _install_review(f, 'integration-canary')
        f.termination = f.evidence('builder terminated before permission')
        inventory = f.put(trusted.T + '/worker-inventory.json', {**common('trusted-v4-worker-inventory'),
            'supervisorTask': f.root['supervisorTask'], 'workers': [{'taskId': 'builder',
                'processIdentity': 'builder-process', 'startedUtc': '2026-10-28T00:00:00Z'}]})
        selection = f.put(trusted.E + '/selection.json', {'synthetic': 'registered selection; Stage C still required'})
        denial_ref = ref(trusted.T + '/custodian/0.json', f.artifacts[trusted.T + '/custodian/0.json'])
        f.freeze = f.put(trusted.E + '/freeze.json', f.envelope('freeze', {'selection': selection,
            'registration': f.protocol, 'reviews': [f.protocol], 'denialReceipt': denial_ref,
            'builderTerminationReceipts': [f.termination], 'parentPlan': f.protocol}))
        accepted = f.observe({'event': 'FREEZE_ACCEPTED', 'freeze': f.freeze, 'selection': selection},
            [('accept-freeze', f.freeze['path'], 'ACCEPTED')], [selection, denial_ref])
        binding = next(binding for binding in f.root['authorities'] if binding['node'] == 'selection-freeze')
        binding.update(state='PASS', acceptedReview=None,
            observation=ref(trusted.T + '/custodian/1.json', f.artifacts[trusted.T + '/custodian/1.json']),
            boundInputs=[f.root['runtimeManifest'], f.freeze, selection, accepted['actionRecord']])
        stopped = f.observe({'event': 'BUILDERS_STOPPED', 'workers': [{'taskId': 'builder',
            'processIdentity': 'builder-process', 'startedUtc': '2026-10-28T00:00:00Z',
            'stoppedUtc': '2026-10-29T00:00:01Z', 'exitObserved': True, 'launcherRecord': f.termination}],
            'completeWorkerSet': ['builder'], 'restartBlockedObserved': True},
            [('terminate', 'builder', 'TERMINATED', 0, f.termination), ('prevent-restart', 'all', 'BLOCKED')], [inventory])
        observed_utc = '2026-10-29T00:00:02.500Z'
        prefix = _validate_label_authorization_prefix_v4(f.root, f.manifest, f.artifacts, observed_utc)
        prerequisites = [binding for binding in f.root['authorities'] if binding['node'] in
                         trusted.PERMISSION_PREREQUISITES['LABEL_EXECUTION']]
        expected = {f.root['runtimeManifest']['path'], f.freeze['path'], f.protocol['path']}
        for binding in prerequisites:
            expected |= {item['path'] for item in binding['boundInputs']}
            expected |= {item['path'] for item in (binding['acceptedReview'], binding['observation']) if item}
        expected |= {item['path'] for item in prefix}
        authorization = {**common('trusted-v4-authorization'), 'permission': 'LABEL_EXECUTION',
            'supervisorTask': f.root['supervisorTask'], 'observedUtc': observed_utc,
            'runtimeManifest': f.root['runtimeManifest'], 'identity': f.manifest['identity'],
            'boundInputs': [ref(path, f.artifacts[path]) for path in sorted(expected)], 'prerequisites': prerequisites}
        trusted._validate_authorization(f.root, f.manifest, authorization, f.artifacts)
        for mutation in ('before-stopped', 'same-time', 'non-utc', 'missing-inventory', 'missing-stop-action',
                         'missing-termination', 'extra-input', 'unknown-field'):
            bad = copy.deepcopy(authorization)
            if mutation == 'before-stopped': bad['observedUtc'] = '2026-10-29T00:00:01Z'
            if mutation == 'same-time': bad['observedUtc'] = stopped['observedUtc']
            if mutation == 'non-utc': bad['observedUtc'] = '2026-10-29T01:00:02.500+01:00'
            if mutation == 'missing-inventory': bad['boundInputs'] = [item for item in bad['boundInputs'] if item['path'] != inventory['path']]
            if mutation == 'missing-stop-action': bad['boundInputs'] = [item for item in bad['boundInputs'] if item['path'] != stopped['actionRecord']['path']]
            if mutation == 'missing-termination': bad['boundInputs'] = [item for item in bad['boundInputs'] if item['path'] != f.termination['path']]
            if mutation == 'extra-input': bad['boundInputs'].append(ref(trusted.T + '/synthetic-upstream.json', b'{}'))
            if mutation == 'unknown-field': bad['stopObserved'] = True
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                trusted._validate_authorization(f.root, f.manifest, bad, f.artifacts)
        # Consistent repinning does not excuse a logically future stop report.
        altered_root, altered_artifacts, altered_authorization = copy.deepcopy((f.root, f.artifacts, authorization))
        stop_path = trusted.T + '/custodian/2.json'
        altered_stop = trusted._parse(altered_artifacts[stop_path])
        altered_stop['detail']['workers'][0]['stoppedUtc'] = '2026-10-29T00:00:03Z'
        altered_artifacts[stop_path] = raw(altered_stop)
        repinned = ref(stop_path, altered_artifacts[stop_path])
        for slot in altered_root['artifacts']:
            if slot['artifact']['path'] == stop_path: slot['artifact'] = repinned
        altered_authorization['boundInputs'] = [repinned if item['path'] == stop_path else item
                                                for item in altered_authorization['boundInputs']]
        with self.assertRaises(ValueError):
            trusted._validate_authorization(altered_root, f.manifest, altered_authorization, altered_artifacts)
        absent_stop = copy.deepcopy(f.root)
        absent_stop['artifacts'] = [slot for slot in absent_stop['artifacts'] if slot['artifact']['path'] != stop_path]
        with self.assertRaises(ValueError):
            trusted._validate_authorization(absent_stop, f.manifest, authorization, f.artifacts)
        auth_ref = f.put(trusted.T + '/authorizations/LABEL_EXECUTION.json', authorization)
        f.observe({'event': 'LABELS_STARTED', 'authorization': auth_ref, 'privateStoreId': 'opaque-store'},
            [('private-store', 'opaque-store', 'CUSTODIAN_CONTROLLED'), ('labels-start', 'holdout', 'STARTED')], [auth_ref])
        # The permission remains verifiable after its later consumer is registered,
        # proving the prefix check does not recurse through LABELS_STARTED.
        trusted._validate_authorization(f.root, f.manifest, authorization, f.artifacts)
        for ordinal, slot in enumerate(f.root['artifacts']): slot['slot'] = 'label-' + str(ordinal)
        trusted._snapshot_from_test_bytes(f.root, f.manifest, registry, f.artifacts)



class PublicExecutionTimeTests(unittest.TestCase):
    """Real fixed-path constructor/consumer; only reads redirect to Temp bytes."""
    def setUp(self):
        self.f, self.registry = _complete_proof_snapshot_fixture(self)

    def public_consume(self):
        f, registry = self.f, self.registry
        f.root['executionRegistry'] = f.put(trusted.T + '/execution-registry.json', registry)
        for index, slot in enumerate(f.root['artifacts']): slot['slot'] = 'time-' + str(index)
        corpus = trusted._parse(f.artifacts[trusted.CORPUS + '/manifest.json'])
        files = dict(f.artifacts)
        files[trusted.C + '/run.json'] = raw({'nodes': {'A3V4-trusted-root': f.root,
            'A2R-corpus': {'status': 'produced', 'corpusVersion': corpus['corpusVersion'],
                          'sourceCount': 1, 'chunkCount': 1}}})
        with tempfile.TemporaryDirectory(prefix='synthetic-public-time-') as folder:
            physical = {}
            for index, (logical, data) in enumerate(files.items()):
                target = Path(folder).resolve() / str(index); target.write_bytes(data)
                physical[logical] = str(target)
            physical[trusted.SCHEMA_PATH] = physical[trusted.P + '/semantic-v4-trusted-interfaces.schema.json']
            physical[str(trusted.CONTRACT_PATH)] = physical[trusted.P + '/semantic-v4-adoption-contract.json']
            actual_read = trusted._read_stable
            def read(logical, limit=2_000_000, identities=None):
                return actual_read(physical[logical], limit, identities)
            with patch.object(trusted, '_read_stable', side_effect=read):
                snapshot = trusted.load_trusted_snapshot_v4()
                consumed = set()
                for entry in registry['entries']:
                    scope = entry['scope']
                    key = entry['purpose']  # The loader has already validated every registered role/batch.
                    if key in consumed: continue
                    consumed.add(key)
                    executions = trusted.registered_executions_v4(snapshot, entry['purpose'],
                        scope['configuration'], scope['caseIds'], scope['groupId'])
                    self.assertTrue(executions)
                return snapshot

    def authorization_time(self, value):
        path = self.registry['entries'][0]['authorization']['path']
        auth = trusted._parse(self.f.artifacts[path]); auth['observedUtc'] = value
        reference = self.f.put(path, auth)
        for entry in self.registry['entries']: entry['authorization'] = reference

    def set_time(self, field, value, *, index=0, missing=False):
        entry = self.registry['entries'][index]
        if field == 'A':
            path = entry['authorization']['path']; record = trusted._parse(self.f.artifacts[path])
            if missing: record.pop('observedUtc')
            else: record['observedUtc'] = value
            reference = self.f.put(path, record)
            for other in self.registry['entries']:
                if other['authorization']['path'] == path: other['authorization'] = reference
        elif field == 'S':
            path = entry['invocation']['path']; invocation = trusted._parse(self.f.artifacts[path])
            if missing: invocation.pop('startedUtc')
            else: invocation['startedUtc'] = value
            entry['invocation'] = self.f.put(path, invocation)
            entry['trustedPins']['expectedFileHashes']['invocation.json'] = entry['invocation']['sha256']
        else:
            if missing: entry.pop('observedUtc')
            else: entry['observedUtc'] = value

    def test_public_time_order_boundaries_and_cache_each_entry_both_orders(self):
        baseline = copy.deepcopy((self.f, self.registry))
        for field, value in [('A', '2026-10-29T00:01:30Z'), ('A', '2026-10-29T00:01:01Z'),
                             ('O', '2026-10-29T00:01:00Z'), ('S', '2026-10-29T00:00:59Z')]:
            for reverse in (False, True):
                self.f, self.registry = copy.deepcopy(baseline)
                self.set_time(field, value, index=1)
                if reverse: self.registry['entries'].reverse()
                with self.subTest(field=field, value=value, reverse=reverse), self.assertRaisesRegex(
                        ValueError, 'authorization must predate start'):
                    self.public_consume()
        self.f, self.registry = copy.deepcopy(baseline)
        for entry in self.registry['entries']: entry['observedUtc'] = '2026-10-29T00:01:01+00:00'
        self.public_consume()

    def test_public_required_time_types_syntax_and_precision(self):
        baseline = copy.deepcopy((self.f, self.registry))
        invalid = [None, True, False, 0, 1.25, '', '2026-02-30T00:01:01Z',
            '2026-10-29T00:01:01', '2026-10-29T01:01:01+01:00', '2026-10-29T00:01:01-00:00',
            '2026-10-29T00:01:01.00000001Z', '2026-10-29T00:01:01.Z',
            '2026-10-29 00:01:01Z', '2026-10-29T00:01:01z', ' 2026-10-29T00:01:01Z',
            '2026-10-29T00:01:01Z\n', '2026-10-29T24:00:00Z', '2026-10-29T00:01:60Z',
            '2026-10-29T00:01:01+00:00:00', '２０２６-10-29T00:01:01Z', '0000-10-29T00:01:01Z']
        for field in ('A', 'S', 'O'):
            for missing, value in [(True, None), *[(False, value) for value in invalid]]:
                self.f, self.registry = copy.deepcopy(baseline)
                self.set_time(field, value, missing=missing)
                with self.subTest(field=field, value=value, missing=missing), self.assertRaises(ValueError):
                    self.public_consume()

    def test_public_lossless_seventh_digit_equivalent_utc_and_equal_observation(self):
        baseline = copy.deepcopy((self.f, self.registry))
        for suffix in ('Z', '+00:00'):
            for precision in range(8):
                self.f, self.registry = copy.deepcopy(baseline)
                fraction = '.' + '1' * precision if precision else ''
                self.authorization_time('2026-10-29T00:01:00' + fraction + suffix)
                for index, entry in enumerate(self.registry['entries']):
                    self.set_time('S', '2026-10-29T00:01:01' + fraction + suffix, index=index)
                    entry['observedUtc'] = '2026-10-29T00:01:01' + fraction + ('+00:00' if suffix == 'Z' else 'Z')
                self.public_consume()
        self.f, self.registry = copy.deepcopy(baseline)
        self.authorization_time('2026-10-29T00:01:01.1234566+00:00')
        for index, entry in enumerate(self.registry['entries']):
            self.set_time('S', '2026-10-29T00:01:01.1234567Z', index=index)
            entry['observedUtc'] = '2026-10-29T00:01:01.1234567+00:00'
        self.public_consume()
        # O is earlier only at the seventh digit: datetime microsecond truncation would accept it.
        self.set_time('O', '2026-10-29T00:01:01.1234566Z', index=1)
        with self.assertRaisesRegex(ValueError, 'observation must not precede start'): self.public_consume()
        # Equivalent spellings of the same instant still cannot satisfy strict A < S.
        self.set_time('O', '2026-10-29T00:01:01.1234567Z', index=1)
        self.authorization_time('2026-10-29T00:01:01.1234567+00:00')
        with self.assertRaisesRegex(ValueError, 'authorization must predate start'): self.public_consume()

    def prepare_other_purpose(self, purpose):
        """Build all actual Stage B predicates; semantic adoption is outside this fixture."""
        from test_trusted_custody_v4 import RegistryTests
        import trusted_custody_v4 as custody
        from proof_transport_v4 import compact_schedule
        from semantic_readiness_v4 import _cases, _judge_cases
        from readiness import READER, JUDGE, reader_schema, judge_schema
        f = self.f
        builder = RegistryTests(); builder.f = f; builder.registry = self.registry
        self.addCleanup(builder.doCleanups)
        builder.originals, builder.sources = custody._corpus_maps(f.manifest, f.artifacts)
        builder.evidence = list(builder.originals.values())
        builder.case = trusted._parse(f.artifacts[trusted.D + '/references.json'])['queries'][0]
        builder.group = builder.case['groups'][0]
        builder.packet = next(entry['scope']['packets'][0] for entry in self.registry['entries'])
        builder.proof_schema = Path(__file__).with_name('semantic-v4-proof-output.schema.json').read_bytes()
        # Rebuild each purpose's own permission, without retaining a stale proof permission.
        def remove(paths):
            f.root['artifacts'][:] = [slot for slot in f.root['artifacts'] if slot['artifact']['path'] not in paths]
            for path in paths: f.artifacts.pop(path, None)
        remove({trusted.T + '/authorizations/DEV_PROOF_EXECUTION.json'})
        self.registry['entries'] = []

        def authorize(permission, inputs=()):
            prereqs = [item for item in f.root['authorities'] if item['node'] in trusted.PERMISSION_PREREQUISITES[permission]]
            needed = {f.root['runtimeManifest']['path'], f.protocol['path']}
            if permission == 'DEV_EQUIVALENCE_EXECUTION':
                needed |= {trusted.D + '/candidate-mapping.json', trusted.D + '/references.json', trusted.D + '/reviews/schedule.json'}
                schedule = trusted._parse(f.artifacts[trusted.D + '/reviews/schedule.json'])
                needed |= {trusted.D + '/reviews/projections/' + str(row['batchOrdinal']) + '.json' for row in schedule['batches']}
            elif permission == 'INTEGRATION_CANARY': needed.add(trusted.E + '/canary-plan.json')
            else:
                needed.add(trusted.E + '/freeze.json')
                if permission == 'HOLDOUT_EXECUTION':
                    needed |= {trusted.E + '/seal-receipt.json', trusted.E + '/claim.json', trusted.E + '/unseal.json'}
            for binding in prereqs:
                needed |= {ref['path'] for ref in binding['boundInputs']}
                needed |= {ref['path'] for ref in (binding['acceptedReview'], binding['observation']) if ref}
            if permission in ('DEV_EQUIVALENCE_EXECUTION', 'INTEGRATION_CANARY'):
                needed |= {entry['artifact']['path'] for entry in f.manifest['entries'] if entry['category'] in ('prompt', 'schema')}
            observed = '2026-10-29T00:00:02.5000000Z' if permission == 'LABEL_EXECUTION' else '2026-10-29T00:01:00Z'
            if permission == 'LABEL_EXECUTION':
                needed |= {ref['path'] for ref in custody._validate_label_authorization_prefix_v4(
                    f.root, f.manifest, f.artifacts, observed)}
            auth = {**common('trusted-v4-authorization'), 'permission': permission,
                'supervisorTask': f.root['supervisorTask'], 'observedUtc': observed,
                'runtimeManifest': f.root['runtimeManifest'], 'identity': f.manifest['identity'],
                'boundInputs': [ref(path, f.artifacts[path]) for path in sorted(needed)], 'prerequisites': prereqs}
            trusted._validate_authorization(f.root, f.manifest, auth, f.artifacts)
            return f.put(trusted.T + '/authorizations/' + permission + '.json', auth)

        if purpose == 'dev-equivalence':
            builder.equivalence()
            # The helper builds a fresh corpus/schedule and runtime; bind complete native review records afterward.
            _rehash_runtime(f.root, f.manifest, f.artifacts)
            f.put(f.root['runtimeManifest']['path'], f.artifacts[f.root['runtimeManifest']['path']])
            candidate_path = trusted.D + '/candidate-mapping.json'
            candidate = trusted._parse(f.artifacts[candidate_path])
            candidate['proofConsumer']['dependencyManifest'] = f.root['runtimeManifest']
            candidate['proofConsumer']['identity'] = f.manifest['identity']
            candidate_ref = f.put(candidate_path, candidate)
            schedule_path = trusted.D + '/reviews/schedule.json'
            schedule = trusted._parse(f.artifacts[schedule_path]); schedule['candidateMapping'] = candidate_ref
            f.put(schedule_path, schedule)
            for node in ('contract-review', 'reference-equivalence', 'adoption-implementation-review', 'current-source-review'):
                _install_review(f, node)
            remove({slot['artifact']['path'] for slot in f.root['artifacts']
                    if slot['artifact']['path'].startswith((trusted.T + '/custodian/', trusted.T + '/synthetic-actions/'))})
            f.observations = []; f.denial()
            binding = next(item for item in f.root['authorities'] if item['node'] == 'isolation-denial')
            obs = f.observations[0]
            binding.update(state='PASS', acceptedReview=None, observation=ref(trusted.T + '/custodian/0.json',
                f.artifacts[trusted.T + '/custodian/0.json']), boundInputs=[f.root['runtimeManifest'], obs['actionRecord'], f.access])
            auth = authorize('DEV_EQUIVALENCE_EXECUTION')
            for entry in self.registry['entries']:
                entry.update(authorization=auth, runtimeManifest=f.root['runtimeManifest'])
            return

        # Dynamic output schemas do not become new runtime inputs; only emitted bytes are registered.
        frozen_entries = copy.deepcopy(f.manifest['entries'])
        original_raw_entry = builder.raw_entry
        def raw_entry(*args, **kwargs):
            entry = original_raw_entry(*args, **kwargs)
            f.manifest['entries'][:] = copy.deepcopy(frozen_entries)
            return entry
        builder.raw_entry = raw_entry
        if purpose.startswith('holdout-'):
            _install_review(f, 'integration-canary')
            remove({slot['artifact']['path'] for slot in f.root['artifacts']
                    if slot['artifact']['path'].startswith((trusted.T + '/custodian/', trusted.T + '/synthetic-actions/'))})
            f.observations = []
            f.auth = authorize
            original_observe = f.observe
            nodes = {'DENIAL_OBSERVED': 'isolation-denial', 'FREEZE_ACCEPTED': 'selection-freeze',
                     'SEALED': 'label-seal', 'CLAIM_CREATED': 'holdout-claim', 'UNSEALED': 'unseal'}
            def observe(detail, outcomes, inputs=()):
                obs = original_observe(detail, outcomes, inputs)
                if detail['event'] in nodes:
                    binding = next(item for item in f.root['authorities'] if item['node'] == nodes[detail['event']])
                    binding.update(state='PASS', acceptedReview=None, observation=ref(
                        trusted.T + '/custodian/' + str(obs['sequence']) + '.json',
                        f.artifacts[trusted.T + '/custodian/' + str(obs['sequence']) + '.json']),
                        boundInputs=[f.root['runtimeManifest'], obs['actionRecord']])
                return obs
            f.observe = observe
            f.through_seal(); f.claim(); f.released(self)
            unseal_binding = next(item for item in f.root['authorities'] if item['node'] == 'unseal')
            unseal_binding['observation'] = ref(trusted.T + '/custodian/6.json', f.artifacts[trusted.T + '/custodian/6.json'])
            # The shared fixture's raw CLI must match this complete runtime's actual registered CLI.
            for role in ('author', 'checker', 'novelty'):
                folder = trusted.E + '/holdout/seal-evidence/raw/' + role + '/0'
                invocation_path = folder + '/invocation.json'
                invocation = trusted._parse(f.artifacts[invocation_path])
                invocation['cli'] = '/synthetic/cli-executable'
                new_ref = f.put(invocation_path, invocation)
                binding_path = folder + '/release-binding.json'; binding = trusted._parse(f.artifacts[binding_path])
                action_path = folder + '/custodian-replay.json'; action = trusted._parse(f.artifacts[action_path])
                binding['releasedFiles']['invocation.json'] = new_ref
                binding['expectedFileHashes']['invocation.json'] = new_ref['sha256']
                action['inputs'] = [new_ref if item['path'] == invocation_path else item for item in action['inputs']]
                action_ref = f.put(action_path, action); binding['custodianReplayAction'] = action_ref
                f.put(binding_path, binding)
                released_path = trusted.E + '/holdout/released-seal.json'; released = trusted._parse(f.artifacts[released_path])
                execution = next(row for row in released['executions'] if row['role'] == role)
                execution.update(releasedFiles=binding['releasedFiles'], expectedFileHashes=binding['expectedFileHashes'],
                                 custodianReplayAction=action_ref)
                f.put(released_path, released)
            reference = ref(trusted.E + '/holdout/references.json', f.artifacts[trusted.E + '/holdout/references.json'])
            rows = trusted._parse(f.artifacts[reference['path']])['payload']['queries']
        else:
            rows = [builder.case]
            reference = f.put(trusted.E + '/canary-plan.json', {'queries': rows})

        packets = {row['id']: f.put(trusted.E + '/synthetic-public-packets/' + row['id'] + '.json',
            {'queryEn': row['queryEn'], 'evidence': builder.evidence, 'reference': reference}) for row in rows}
        if purpose in ('holdout-proof', 'holdout-both'):
            row = rows[0]; group = row['groups'][0]
            plan = compact_schedule(row['id'], row['queryEn'], group, builder.evidence, builder.originals)
            for call in plan['calls']:
                role, ordinal = call['checkerId'], 0
                output = f"{trusted.E}/holdout/raw/proof/{row['id']}/{group['id']}/{role}/{ordinal}"
                entry = builder.raw_entry(output, call['prompt'], role, call['projectionHash'], schema=builder.proof_schema,
                    result=builder.proof_output(call), ordinal=ordinal)
                entry.update(purpose='holdout-proof', scope={'configuration': 'selected', 'caseIds': [row['id']],
                    'groupId': group['id'], 'packets': [packets[row['id']]], 'reference': reference,
                    'protocol': f.protocol, 'projectionHash': call['projectionHash'],
                    'prompt': entry.pop('promptRef'), 'schema': entry['emittedSchema']})
                self.registry['entries'].append(entry)
        if purpose != 'holdout-proof':
            readiness_purpose = 'holdout-readiness' if purpose == 'holdout-both' else purpose
            for ordinal, start in enumerate(range(0, len(rows), 3)):
                batch = rows[start:start + 3]
                packet_refs = [packets[row['id']] for row in batch]
                packet_values = [{'caseId': row['id'], 'queryEn': row['queryEn'], 'evidence': builder.evidence} for row in batch]
                cases = _cases(batch, packet_values, builder.originals, builder.sources, reference['sha256'])
                ids = [row['id'] for row in cases]
                answers = [{'id': opaque, 'verdict': 'needs_evidence', 'answer': '', 'scope': '',
                    'supportingEvidenceIds': [], 'refusalReason': 'Synthetic refusal'} for opaque in ids]
                for role in ('reader', 'judge'):
                    projection = cases if role == 'reader' else _judge_cases(batch, cases, dict(zip(ids, answers)))
                    body = {'cases': projection}; digest = trusted._digest(body)
                    prompt = (READER if role == 'reader' else JUDGE) + canonical(body)
                    schema = json.dumps((reader_schema if role == 'reader' else judge_schema)(ids), ensure_ascii=False, indent=2).encode()
                    result = {'cases': answers if role == 'reader' else [{'id': opaque,
                        'verdict': 'unnecessary_refusal', 'reason': 'Synthetic only'} for opaque in ids]}
                    prefix = trusted.T + '/canary/raw' if purpose == 'integration-canary' else trusted.E + '/holdout/raw/readiness'
                    entry = builder.raw_entry(f'{prefix}/{role}/{ordinal}', prompt, role, digest, schema=schema, result=result, ordinal=ordinal)
                    entry.update(purpose=readiness_purpose, scope={'configuration': 'selected', 'caseIds': [row['id'] for row in batch],
                        'groupId': None, 'packets': packet_refs, 'reference': reference, 'protocol': f.protocol,
                        'projectionHash': digest, 'prompt': entry.pop('promptRef'), 'schema': entry['emittedSchema']})
                    self.registry['entries'].append(entry)
        if purpose == 'integration-canary':
            binding = next(item for item in f.root['authorities'] if item['node'] == 'isolation-denial')
        else:
            binding = next(item for item in f.root['authorities'] if item['node'] == 'unseal')
        binding['boundInputs'] += list(packets.values())
        auth = authorize('HOLDOUT_EXECUTION' if purpose == 'holdout-both' else custody.PERMISSIONS[purpose])
        for entry in self.registry['entries']: entry['authorization'] = auth

    def test_all_five_public_purposes_full_loader_consumer_and_time_rejection(self):
        baseline = copy.deepcopy((self.f, self.registry))
        for purpose in ('dev-proof', 'dev-equivalence', 'integration-canary', 'holdout-proof', 'holdout-readiness'):
            self.f, self.registry = copy.deepcopy(baseline)
            with self.subTest(purpose=purpose):
                if purpose != 'dev-proof': self.prepare_other_purpose(purpose)
                self.public_consume()
                import trusted_custody_v4 as custody
                # Each role and batch is checked through the shared registry predicate used by the public loader.
                for entry in self.registry['entries']:
                    original = entry['observedUtc']; entry['observedUtc'] = '2026-10-29T00:01:00Z'
                    self.f.root['executionRegistry'] = self.f.put(trusted.T + '/execution-registry.json', self.registry)
                    with self.subTest(role=entry['role'], ordinal=entry['batchOrdinal']), self.assertRaisesRegex(
                            ValueError, 'observation must not precede start'):
                        custody.validate_execution_registry_v4(self.f.root, self.f.manifest, self.registry, self.f.artifacts)
                    entry['observedUtc'] = original
                self.set_time('O', '2026-10-29T00:01:00Z', index=-1)
                with self.assertRaisesRegex(ValueError, 'observation must not precede start'): self.public_consume()
                self.set_time('O', '2026-10-29T00:02:00Z', index=-1)
                self.authorization_time('2026-10-30T00:00:00Z')
                with self.assertRaisesRegex(ValueError, 'authorization must predate start'): self.public_consume()

    def test_both_holdout_purposes_share_authorization_but_check_every_entry_in_both_orders(self):
        self.prepare_other_purpose('holdout-both')
        self.public_consume()
        self.assertEqual({'holdout-proof', 'holdout-readiness'}, {row['purpose'] for row in self.registry['entries']})
        self.assertEqual(1, len({canonical(row['authorization']) for row in self.registry['entries']}))
        for purpose in ('holdout-proof', 'holdout-readiness'):
            for reverse in (False, True):
                row = next(entry for entry in reversed(self.registry['entries']) if entry['purpose'] == purpose)
                original = row['observedUtc']; row['observedUtc'] = '2026-10-29T00:01:00Z'
                if reverse: self.registry['entries'].reverse()
                with self.subTest(purpose=purpose, reverse=reverse), self.assertRaisesRegex(
                        ValueError, 'observation must not precede start'):
                    self.public_consume()
                row['observedUtc'] = original
                if reverse: self.registry['entries'].reverse()

    def test_original_future_authorization_rejects_after_consistent_rehash(self):
        self.public_consume()
        raw_before = {entry[field]['path']: self.f.artifacts[entry[field]['path']]
                      for entry in self.registry['entries'] for field in
                      ('execution', 'invocation', 'result', 'events', 'stderr', 'emittedSchema')}
        self.authorization_time('2026-10-30T00:00:00Z')
        self.assertTrue(all(self.f.artifacts[path] == data for path, data in raw_before.items()))
        with self.assertRaisesRegex(ValueError, 'authorization.*start|Authorization.*start'):
            self.public_consume()


if __name__ == '__main__':
    unittest.main()
