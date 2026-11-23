import { useAuth } from '../../contexts/AuthContext';
import { bannerGradientFor, initialsOf, locationLabel } from './profileIdentityView';
import { useAvatarUpload, useBannerPicker } from './useProfileIdentity';
import { AvatarActions, AvatarButton, IdentityBanner, IdentityDetails } from './ProfileIdentityParts';

/** Cartão de identidade do Perfil: banner personalizável, foto e dados do plano. */
export const ProfileIdentity = () => {
    const { user } = useAuth();
    const avatar = useAvatarUpload();
    const banner = useBannerPicker();

    // Fallback seguro
    const userPlan = user?.plan || 'GUEST';

    return (
        <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-full relative group">
            <IdentityBanner
                hasUser={!!user}
                plan={userPlan}
                gradient={bannerGradientFor(userPlan, user?.bannerColor)}
                pickerOpen={banner.pickerOpen}
                onToggle={banner.togglePicker}
                bannerColor={user?.bannerColor}
                saving={banner.saving}
                onApply={banner.applyBanner}
            />

            <div className="px-6 relative flex-1 flex flex-col">
                <AvatarButton
                    avatar={user?.avatar}
                    initials={initialsOf(user?.name)}
                    uploading={avatar.uploadingAvatar}
                    onPick={avatar.openFilePicker}
                />
                <input
                    ref={avatar.fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={avatar.handleAvatarPick}
                    className="hidden"
                />

                <IdentityDetails
                    name={user?.name}
                    email={user?.email}
                    plan={userPlan}
                    location={locationLabel(user?.city, user?.state)}
                    subscriptionStatus={user?.subscriptionStatus}
                />

                <AvatarActions
                    hasAvatar={!!user?.avatar}
                    uploading={avatar.uploadingAvatar}
                    onPick={avatar.openFilePicker}
                    onRemove={avatar.handleAvatarRemove}
                />
            </div>
        </div>
    );
};
